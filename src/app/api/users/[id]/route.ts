import { assertRole, audit, fail, getSession, isSameOrigin, ok } from '@/lib/auth';
import { one, run } from '@/lib/db';

export const runtime = 'nodejs';

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return fail('Origin not allowed', 403);
  const session = await getSession();
  if (!session) return fail('Sign in required', 401);
  const denied = assertRole(session, 'admin');
  if (denied) return denied;
  const id = Number((await context.params).id);
  if (!Number.isSafeInteger(id) || id < 1) return fail('Invalid user id');
  if (session.userId === id) return fail('You cannot delete your own signed-in account');
  const target = await one<{username:string;role:string;active:number;deleted_at:string|null}>('SELECT username,role,active,deleted_at FROM users WHERE id=$1', [id]);
  if (!target) return fail('User not found', 404);
  if (target.role === 'admin' && target.active) {
    const admins = await one<{n:number}>("SELECT COUNT(*)::int AS n FROM users WHERE role='admin' AND active=1");
    if ((admins?.n ?? 0) <= 1) return fail('Cannot delete the last active administrator', 409);
  }
  if (target.deleted_at) return fail('Account is already marked deleted', 409);
  await run('UPDATE users SET active=0,deleted_at=NOW(),session_version=session_version+1 WHERE id=$1', [id]);
  await audit(session.userId, 'user.soft_delete', target.username);
  return ok({message:'Account marked deleted; its record has been retained'});
}
