import { assertRole, audit, fail, getSession, isSameOrigin, ok } from '@/lib/auth';
import { all, one } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET() {
  const session = await getSession();
  if (!session) return fail('Sign in required', 401);
  const denied = assertRole(session, 'admin');
  if (denied) return denied;
  const [snapshots, counts] = await Promise.all([
    all('SELECT s.id,s.label,s.created_at,u.username AS created_by FROM system_config_snapshots s LEFT JOIN users u ON u.id=s.created_by ORDER BY s.id DESC LIMIT 50'),
    one('SELECT (SELECT COUNT(*)::int FROM users) AS users,(SELECT COUNT(*)::int FROM books) AS books,(SELECT COUNT(*)::int FROM library_members) AS members,(SELECT COUNT(*)::int FROM loans) AS loans'),
  ]);
  return ok({snapshots, counts});
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return fail('Origin not allowed', 403);
  const session = await getSession();
  if (!session) return fail('Sign in required', 401);
  const denied = assertRole(session, 'admin');
  if (denied) return denied;
  const body = await request.json().catch(() => null) as {label?:unknown}|null;
  const label = typeof body?.label === 'string' && body.label.trim() ? body.label.trim().slice(0,80) : `Configuration ${new Date().toISOString()}`;
  const snapshot = await one<{id:number}>(`INSERT INTO system_config_snapshots(label,settings,created_by)
    VALUES($1,(SELECT COALESCE(jsonb_object_agg(setting_key,setting_value),'{}'::jsonb) FROM system_settings),$2)
    RETURNING id`, [label, session.userId]);
  await audit(session.userId, 'settings.snapshot_create', String(snapshot?.id));
  return ok({id:snapshot?.id,label}, 201);
}
