import { assertRole, audit, fail, getSession, isSameOrigin, ok } from '@/lib/auth';
import { one, run } from '@/lib/db';

export const runtime = 'nodejs';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return fail('Origin not allowed', 403);
  const session = await getSession();
  if (!session) return fail('Sign in required', 401);
  const denied = assertRole(session, 'admin', 'computer_admin');
  if (denied) return denied;
  const id = Number((await context.params).id);
  if (!Number.isSafeInteger(id) || id < 1) return fail('Invalid user id');
  if (session.userId === id) return fail('You cannot disable your own signed-in account');
  const target = await one<{username:string;role:string;active:number}>('SELECT username,role,active FROM users WHERE id=$1', [id]);
  if (!target) return fail('User not found', 404);
  if (session.role === 'computer_admin' && ['admin','computer_admin'].includes(target.role)) return fail('Cannot change administrator accounts', 403);
  if (target.role === 'admin' && target.active) {
    const admins = await one<{n:number}>("SELECT COUNT(*)::int AS n FROM users WHERE role='admin' AND active=1");
    if ((admins?.n ?? 0) <= 1) return fail('Cannot disable the last active administrator', 409);
  }
  const active = target.active ? 0 : 1;
  await run('UPDATE users SET active=$1,session_version=session_version+1 WHERE id=$2', [active, id]);
  await audit(session.userId, 'user.active_change', target.username);
  return ok({message:active ? 'Account enabled' : 'Account disabled'});
}
