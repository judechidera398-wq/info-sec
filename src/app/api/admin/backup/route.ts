import { assertRole, audit, fail, getSession, isSameOrigin, ok } from '@/lib/auth';
import { decryptBackup, encryptBackup } from '@/lib/backup';
import { transaction } from '@/lib/db';

export const runtime = 'nodejs';

type BackupData = {
  format: 'vault-library-data';
  version: 1;
  exportedAt: string;
  users: Record<string, unknown>[];
  books: Record<string, unknown>[];
  members: Record<string, unknown>[];
  loans: Record<string, unknown>[];
  recoveryCodes: Record<string, unknown>[];
  auditEvents: Record<string, unknown>[];
  settings: Record<string, unknown>[];
  configSnapshots: Record<string, unknown>[];
};

const columns: Record<keyof Omit<BackupData, 'format'|'version'|'exportedAt'>, string[]> = {
  users: ['id','username','password_hash','google_sub','totp_secret','role','active','session_version','deleted_at','created_at'],
  books: ['id','isbn','title','author','category','publisher','publication_year','copies_total','copies_available','created_by','created_at','updated_at'],
  members: ['id','member_code','full_name','email','phone','active','created_by','created_at','updated_at'],
  loans: ['id','book_id','member_id','checked_out_by','returned_by','checked_out_at','due_at','returned_at'],
  recoveryCodes: ['id','user_id','code_hash','used_at'],
  auditEvents: ['id','actor_id','action','target','outcome','created_at'],
  settings: ['setting_key','setting_value','updated_by','updated_at'],
  configSnapshots: ['id','label','settings','created_by','created_at'],
};

function backupShape(value: unknown): value is BackupData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<BackupData>;
  return data.format === 'vault-library-data' && data.version === 1
    && ['users','books','members','loans','recoveryCodes','auditEvents','settings','configSnapshots']
      .every((key) => Array.isArray(data[key as keyof BackupData]));
}

export async function GET() {
  const session = await getSession();
  if (!session) return fail('Sign in required', 401);
  const denied = assertRole(session, 'admin');
  if (denied) return denied;

  try {
    const data = await transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const [users,books,members,loans,recoveryCodes,auditEvents,settings,configSnapshots] = await Promise.all([
        client.query('SELECT id,username,password_hash,google_sub,totp_secret,role,active,session_version,deleted_at,created_at FROM users ORDER BY id'),
        client.query('SELECT * FROM books ORDER BY id'),
        client.query('SELECT * FROM library_members ORDER BY id'),
        client.query('SELECT * FROM loans ORDER BY id'),
        client.query('SELECT id,user_id,code_hash,used_at FROM recovery_codes ORDER BY id'),
        client.query('SELECT id,actor_id,action,target,outcome,created_at FROM audit_events ORDER BY id'),
        client.query('SELECT setting_key,setting_value,updated_by,updated_at FROM system_settings ORDER BY setting_key'),
        client.query('SELECT id,label,settings,created_by,created_at FROM system_config_snapshots ORDER BY id'),
      ]);
      return {
        format:'vault-library-data' as const, version:1 as const, exportedAt:new Date().toISOString(),
        users:users.rows,books:books.rows,members:members.rows,loans:loans.rows,
        recoveryCodes:recoveryCodes.rows,auditEvents:auditEvents.rows,settings:settings.rows,configSnapshots:configSnapshots.rows,
      };
    });
    const encrypted = encryptBackup(data);
    return Response.json(encrypted, {headers:{'Cache-Control':'no-store','Content-Disposition':`attachment; filename="library-backup-${new Date().toISOString().slice(0,10)}.json"`}});
  } catch (error) {
    console.error('Library backup export failed', error instanceof Error ? error.name : 'UnknownError');
    return fail('Could not create a backup. Confirm BACKUP_ENCRYPTION_KEY is configured.', 500);
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return fail('Origin not allowed', 403);
  const session = await getSession();
  if (!session) return fail('Sign in required', 401);
  const denied = assertRole(session, 'admin');
  if (denied) return denied;
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 16_000_000) return fail('Backup file is too large.', 413);
  const submitted = await request.json().catch(() => null) as {confirmation?:unknown;backup?:unknown}|null;
  if (submitted?.confirmation !== 'RESTORE') return fail('Explicitly confirm restore before replacing current data.');
  let value: unknown;
  try { value = decryptBackup(submitted.backup); }
  catch { return fail('Backup could not be decrypted. Check that it was created by this app using the same BACKUP_ENCRYPTION_KEY.'); }
  if (!backupShape(value)) return fail('Backup contents are invalid or from an unsupported version.');

  const data = value;
  try {
    await transaction(async (client) => {
      await client.query('DELETE FROM sessions');
      await client.query('DELETE FROM pending_mfa');
      await client.query('DELETE FROM login_attempts');
      await client.query('DELETE FROM recovery_codes');
      await client.query('DELETE FROM audit_events');
      await client.query('DELETE FROM system_config_snapshots');
      await client.query('DELETE FROM system_settings');
      await client.query('DELETE FROM loans');
      await client.query('DELETE FROM library_members');
      await client.query('DELETE FROM books');
      await client.query('DELETE FROM users');

      for (const table of Object.keys(columns) as Array<keyof typeof columns>) {
        const fields = columns[table];
        const records = data[table] as Record<string, unknown>[];
        for (const record of records) {
          const values = fields.map((field) => record[field] ?? null);
          const placeholders = fields.map((field, index) => field === 'setting_value' || (field === 'settings' && table === 'configSnapshots')
            ? `$${index+1}::jsonb` : `$${index+1}`);
          await client.query(`INSERT INTO ${table === 'members' ? 'library_members' : table === 'recoveryCodes' ? 'recovery_codes' : table === 'auditEvents' ? 'audit_events' : table === 'configSnapshots' ? 'system_config_snapshots' : table === 'settings' ? 'system_settings' : table}
            (${fields.join(',')}) VALUES(${placeholders.join(',')})`,
          values.map((value, index) => fields[index] === 'setting_value' || (fields[index] === 'settings' && table === 'configSnapshots')
            ? JSON.stringify(value) : value));
        }
      }

      for (const table of ['users','books','library_members','loans','recovery_codes','audit_events','system_config_snapshots']) {
        await client.query(`SELECT setval(pg_get_serial_sequence($1,'id')::regclass,COALESCE((SELECT MAX(id) FROM ${table}),1),EXISTS(SELECT 1 FROM ${table}))`, [table]);
      }
    });
    const actor = await transaction(async (client) => (await client.query<{id:number}>('SELECT id FROM users WHERE id=$1', [session.userId])).rows[0]);
    await audit(actor?.id ?? null, 'backup.restore', `${data.exportedAt}`);
    return ok({message:'Encrypted system backup restored. All previous sessions were signed out.',counts:Object.fromEntries(Object.entries(data).filter(([,rows])=>Array.isArray(rows)).map(([key,rows])=>[key,(rows as unknown[]).length]))});
  } catch (error) {
    console.error('Library backup restore failed', error instanceof Error ? error.name : 'UnknownError');
    return fail('Backup restore failed. The database transaction was rolled back.', 400);
  }
}
