import { assertRole, fail, getSession, ok } from '@/lib/auth';
import { all } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET() {
  const session = await getSession();
  if (!session) return fail('Sign in required', 401);
  const denied = assertRole(session, 'admin');
  if (denied) return denied;
  const rows = await all('SELECT actor_id,action,target,outcome,created_at FROM audit_events ORDER BY id DESC LIMIT 200');
  return ok(rows);
}
