import { assertRole, audit, fail, getSession, isSameOrigin, ok } from '@/lib/auth';
import { all, transaction } from '@/lib/db';
import type { LibrarySettings } from '@/lib/settings';

export const runtime = 'nodejs';

const defaults: LibrarySettings = {
  library_name: 'Vault of Value Library',
  default_loan_days: 14,
  max_active_loans: 5,
};

async function readSettings(): Promise<LibrarySettings> {
  const rows = await all<{setting_key:string;setting_value:unknown}>('SELECT setting_key,setting_value FROM system_settings');
  const result = { ...defaults };
  for (const row of rows) {
    if (row.setting_key === 'library_name' && typeof row.setting_value === 'string') result.library_name = row.setting_value;
    if (row.setting_key === 'default_loan_days' && Number.isInteger(Number(row.setting_value))) result.default_loan_days = Number(row.setting_value);
    if (row.setting_key === 'max_active_loans' && Number.isInteger(Number(row.setting_value))) result.max_active_loans = Number(row.setting_value);
  }
  return result;
}

export async function GET() {
  const session = await getSession();
  if (!session || session.stage !== 'active') return fail('Sign in required', 401);
  return ok(await readSettings());
}

export async function PUT(request: Request) {
  if (!isSameOrigin(request)) return fail('Origin not allowed', 403);
  const session = await getSession();
  if (!session) return fail('Sign in required', 401);
  const denied = assertRole(session, 'admin');
  if (denied) return denied;
  const body = await request.json().catch(() => null) as Partial<LibrarySettings> | null;
  if (!body || typeof body.library_name !== 'string' || body.library_name.trim().length < 2 || body.library_name.trim().length > 80
      || !Number.isInteger(body.default_loan_days) || Number(body.default_loan_days) < 1 || Number(body.default_loan_days) > 90
      || !Number.isInteger(body.max_active_loans) || Number(body.max_active_loans) < 1 || Number(body.max_active_loans) > 50) {
    return fail('Use a library name, a loan period from 1 to 90 days, and a member limit from 1 to 50.');
  }
  const settings: LibrarySettings = {
    library_name: body.library_name.trim(),
    default_loan_days: Number(body.default_loan_days),
    max_active_loans: Number(body.max_active_loans),
  };
  await transaction(async (client) => {
    for (const [setting_key, setting_value] of Object.entries(settings)) {
      await client.query(`INSERT INTO system_settings(setting_key,setting_value,updated_by,updated_at)
        VALUES($1,$2::jsonb,$3,NOW()) ON CONFLICT(setting_key) DO UPDATE
        SET setting_value=EXCLUDED.setting_value,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,
      [setting_key, JSON.stringify(setting_value), session.userId]);
    }
  });
  await audit(session.userId, 'settings.update', settings.library_name);
  return ok(settings);
}
