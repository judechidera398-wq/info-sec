import { audit, addAttempt, createPendingSession, fail, isRateLimited, isSameOrigin, ok, putSessionCookie } from '@/lib/auth';
import { one } from '@/lib/db';
import { verifyPassword } from '@/lib/security';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return fail('Origin not allowed', 403);
  const body = await request.json().catch(() => null) as { username?: unknown; password?: unknown } | null;
  if (typeof body?.username !== 'string' || typeof body.password !== 'string'
      || body.username.length > 64 || body.password.length > 256) return fail('Invalid username or password', 401);
  const username = body.username.trim();
  if (await isRateLimited(username)) return fail('Too many attempts. Try again in 15 minutes.', 429);
  const user = await one<{ id:number; username:string; password_hash:string; role:string; active:number; session_version:number; totp_secret:string|null }>(
    'SELECT id,username,password_hash,role,active,session_version,totp_secret FROM users WHERE LOWER(username)=LOWER($1)', [username]);
  const valid = !!user && !!user.active && user.password_hash.startsWith('$argon2')
    && await verifyPassword(body.password, user.password_hash);
  await addAttempt(username, valid);
  if (!valid || !user) {
    await audit(null, 'auth.password', username, 'failure');
    return fail('Invalid username or password', 401);
  }
  const session = await createPendingSession(user.id, user.session_version);
  await putSessionCookie(session.token);
  await audit(user.id, 'auth.password', username);
  return ok({ mfaRequired: true, mfaEnrolled: !!user.totp_secret });
}
