import { assertRole, audit, fail, getSession, isSameOrigin, ok } from '@/lib/auth';
import { one, transaction } from '@/lib/db';
import type { LibrarySettings } from '@/lib/settings';

export const runtime = 'nodejs';

export async function POST(request: Request, context: {params:Promise<{id:string}>}) {
  if (!isSameOrigin(request)) return fail('Origin not allowed', 403);
  const session = await getSession();
  if (!session) return fail('Sign in required', 401);
  const denied = assertRole(session, 'admin');
  if (denied) return denied;
  const id = Number((await context.params).id);
  if (!Number.isSafeInteger(id) || id < 1) return fail('Invalid configuration snapshot id');
  const snapshot = await one<{label:string;settings:Partial<LibrarySettings>}>(
    'SELECT label,settings FROM system_config_snapshots WHERE id=$1', [id]);
  if (!snapshot) return fail('Configuration restore point not found', 404);
  const settings = snapshot.settings;
  if (typeof settings.library_name !== 'string' || !Number.isInteger(settings.default_loan_days)
      || !Number.isInteger(settings.max_active_loans)) return fail('This restore point is invalid.', 409);
  const values: LibrarySettings = {
    library_name: settings.library_name,
    default_loan_days: Number(settings.default_loan_days),
    max_active_loans: Number(settings.max_active_loans),
  };
  await transaction(async (client) => {
    for (const [setting_key, setting_value] of Object.entries(values)) {
      await client.query(`INSERT INTO system_settings(setting_key,setting_value,updated_by,updated_at)
        VALUES($1,$2::jsonb,$3,NOW()) ON CONFLICT(setting_key) DO UPDATE
        SET setting_value=EXCLUDED.setting_value,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,
      [setting_key, JSON.stringify(setting_value), session.userId]);
    }
  });
  await audit(session.userId, 'settings.snapshot_restore', `${id}:${snapshot.label}`);
  return ok({message:'Configuration restored. Library records and accounts were not changed.',settings:values});
}
