import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPool } from './supabase-db.mjs';

const sqlitePath = resolve(process.env.AUTH_DB || './data/local-access.sqlite3');
const tables = ['users', 'sessions', 'pending_mfa', 'recovery_codes', 'login_attempts', 'audit_events'];

if (!existsSync(sqlitePath)) {
  console.error(`SQLite database was not found at ${sqlitePath}.`);
  process.exit(1);
}

let source;
let pool;
let client;

try {
  source = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  pool = createPool();
  const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  await pool.query(schema);
  const destinationCounts = await Promise.all(tables.map(async (table) => {
    const result = await pool.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
    return result.rows[0].count;
  }));
  if (destinationCounts.some((count) => count !== 0)) {
    throw new Error('The Supabase tables are not empty. Import only into a new Supabase project to avoid mixing accounts.');
  }

  source.exec('BEGIN');
  const columns = new Set(source.pragma('table_info(users)').map((column) => column.name));
  const users = source.prepare(`SELECT id,username,password_hash,${columns.has('google_sub') ? 'google_sub' : 'NULL AS google_sub'},
    totp_secret,role,active,session_version,created_at FROM users ORDER BY id`).all();
  const sessions = source.prepare('SELECT id,token_hash,user_id,session_version,stage,expires_at,created_at FROM sessions ORDER BY id').all();
  const pending = source.prepare('SELECT session_id,seed_ciphertext,created_at FROM pending_mfa ORDER BY session_id').all();
  const recovery = source.prepare('SELECT id,user_id,code_hash,used_at FROM recovery_codes ORDER BY id').all();
  const attempts = source.prepare('SELECT id,username,attempted_at,success FROM login_attempts ORDER BY id').all();
  const audit = source.prepare('SELECT id,actor_id,action,target,outcome,created_at FROM audit_events ORDER BY id').all();
  const userIds = new Set(users.map((user) => user.id));
  source.exec('COMMIT');

  client = await pool.connect();
  await client.query('BEGIN');
  for (const user of users) {
    const role = user.role === 'computer_admin' ? 'manager' : user.role;
    await client.query(`INSERT INTO users(id,username,password_hash,google_sub,totp_secret,role,active,session_version,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [user.id,user.username,user.password_hash,user.google_sub,user.totp_secret,
      role,user.active,user.session_version,user.created_at]);
  }
  for (const session of sessions) {
    await client.query(`INSERT INTO sessions(id,token_hash,user_id,session_version,stage,expires_at,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7)`, [session.id,session.token_hash,session.user_id,session.session_version,
      session.stage,session.expires_at,session.created_at]);
  }
  for (const row of pending) {
    await client.query('INSERT INTO pending_mfa(session_id,seed_ciphertext,created_at) VALUES($1,$2,$3)',
      [row.session_id,row.seed_ciphertext,row.created_at]);
  }
  for (const row of recovery) {
    await client.query('INSERT INTO recovery_codes(id,user_id,code_hash,used_at) VALUES($1,$2,$3,$4)',
      [row.id,row.user_id,row.code_hash,row.used_at]);
  }
  for (const row of attempts) {
    await client.query('INSERT INTO login_attempts(id,username,attempted_at,success) VALUES($1,$2,$3,$4)',
      [row.id,row.username,row.attempted_at,row.success]);
  }
  for (const row of audit) {
    const actorId = row.actor_id !== null && userIds.has(row.actor_id) ? row.actor_id : null;
    await client.query('INSERT INTO audit_events(id,actor_id,action,target,outcome,created_at) VALUES($1,$2,$3,$4,$5,$6)',
      [row.id,actorId,row.action,row.target,row.outcome,row.created_at]);
  }

  for (const table of ['users','sessions','recovery_codes','login_attempts','audit_events']) {
    await client.query(`SELECT setval(pg_get_serial_sequence('${table}','id'),
      GREATEST(COALESCE((SELECT MAX(id) FROM ${table}),1),1),
      EXISTS(SELECT 1 FROM ${table}))`);
  }
  await client.query('COMMIT');
  console.log('SQLite data copied to Supabase successfully:');
  console.log(`  users: ${users.length}; sessions: ${sessions.length}; pending MFA setups: ${pending.length}`);
  console.log(`  recovery codes: ${recovery.length}; login attempts: ${attempts.length}; audit events: ${audit.length}`);
  console.log('The local SQLite file was left unchanged. Keep AUTH_PEPPER and MFA_ENCRYPTION_KEY unchanged.');
} catch (error) {
  if (client) await client.query('ROLLBACK').catch(() => {});
  console.error('SQLite import failed; the transaction was rolled back.');
  if (error instanceof Error) console.error(error.message);
  process.exitCode = 1;
} finally {
  client?.release();
  source?.close();
  await pool?.end();
}
