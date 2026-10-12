import { assertRole, audit, fail, getSession, isSameOrigin, ok, type Role } from '@/lib/auth';
import { one, run } from '@/lib/db';

export const runtime = 'nodejs';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return fail('Origin not allowed', 403);
  const session = await getSession();
  if (!session) return fail('Sign in required', 401);
  const denied = assertRole(session, 'admin');
  if (denied) return denied;
  const id = Number((await context.params).id);
  const body = await request.json().catch(() => null) as {role?:unknown}|null;
  const validRoles: Role[] = ['admin','computer_admin','manager','user'];
  if (!Number.isSafeInteger(id) || id < 1 || typeof body?.role !== 'string' || !validRoles.includes(body.role as Role)) return fail('Invalid request');
  const target = await one<{username:string;role:Role}>('SELECT username,role FROM users WHERE id=$1', [id]);
  if (!target) return fail('User not found', 404);
  if (target.role === 'admin' && body.role !== 'admin') {
    const admins = await one<{n:number}>("SELECT COUNT(*)::int AS n FROM users WHERE role='admin' AND active=1");
    if ((admins?.n ?? 0) <= 1) return fail('Cannot demote the last active administrator', 409);
  }
  await run('UPDATE users SET role=$1 WHERE id=$2', [body.role, id]);
  await audit(session.userId, 'user.role_change', `${target.username}:${body.role}`);
  return ok({message:'Role updated'});
}
