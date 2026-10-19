import { assertRole, audit, fail, getSession, isSameOrigin, ok } from '@/lib/auth';
import { all, one } from '@/lib/db';
import { hashPassword } from '@/lib/security';

export const runtime = 'nodejs';

export async function GET() {
  const session = await getSession();
  if (!session) return fail('Sign in required', 401);
  const denied = assertRole(session, 'admin');
  if (denied) return denied;
  const rows = await all('SELECT id,username,role,active,deleted_at,created_at FROM users ORDER BY id');
  return ok(rows);
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return fail('Origin not allowed', 403);
  const session = await getSession();
  if (!session) return fail('Sign in required', 401);
  const denied = assertRole(session, 'admin');
  if (denied) return denied;
  const body = await request.json().catch(() => null) as {username?:unknown;password?:unknown;role?:unknown}|null;
  const role = body?.role ?? 'inputer';
  if (typeof body?.username !== 'string' || !/^[A-Za-z0-9_.-]{3,64}$/.test(body.username)
      || typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 256
      || !['admin','manager','inputer','user'].includes(String(role))) {
    return fail('Use a valid username, a password of at least 12 characters, and a valid role.');
  }
  try {
    const encoded = await hashPassword(body.password);
    const result = await one<{id:string}>('INSERT INTO users(username,password_hash,role) VALUES($1,$2,$3) RETURNING id',
      [body.username, encoded, role]);
    await audit(session.userId, 'user.create', body.username);
    return ok({id:Number(result?.id),username:body.username,role}, 201);
  } catch (error) {
    if ((error as {code?:string})?.code === '23505') return fail('Username is unavailable', 409);
    throw error;
  }
}
