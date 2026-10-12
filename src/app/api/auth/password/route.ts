import { addAttempt, audit, consumeRecoveryCode, fail, getSession, isRateLimited, isSameOrigin, ok, putSessionCookie, rotateActiveSession } from '@/lib/auth';
import { one, run } from '@/lib/db';
import { getEncryptedTotp, validTotp } from '@/lib/mfa';
import { hashPassword, verifyPassword } from '@/lib/security';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return fail('Origin not allowed', 403);
  const session = await getSession();
  if (!session || session.stage !== 'active') return fail('Sign in required', 401);
  const body = await request.json().catch(() => null) as { currentPassword?:unknown; newPassword?:unknown; code?:unknown } | null;
  if (typeof body?.currentPassword !== 'string' || typeof body.newPassword !== 'string'
      || body.newPassword.length < 12 || body.newPassword.length > 256 || typeof body.code !== 'string') {
    return fail('Enter the current password, a new password of 12 or more characters, and an MFA code.');
  }
  if (await isRateLimited(session.username)) return fail('Too many attempts. Try again in 15 minutes.', 429);
  const user = await one<{password_hash:string;session_version:number}>('SELECT password_hash,session_version FROM users WHERE id=$1 AND active=1', [session.userId]);
  if (!user || !await verifyPassword(body.currentPassword, user.password_hash)) {
    await addAttempt(session.username, false);
    return fail('Current password is incorrect', 401);
  }
  const code = body.code.trim().replace(/\s/g, '');
  const seed = await getEncryptedTotp(session.userId);
  let valid = !!seed && validTotp(seed, code);
  if (!valid && code.length >= 10) valid = await consumeRecoveryCode(session.userId, code);
  await addAttempt(session.username, valid);
  if (!valid) return fail('Invalid verification code', 401);
  const hash = await hashPassword(body.newPassword);
  const nextVersion = user.session_version + 1;
  await run('UPDATE users SET password_hash=$1,session_version=$2 WHERE id=$3', [hash, nextVersion, session.userId]);
  const token = await rotateActiveSession(session.sessionId, session.userId, nextVersion);
  await putSessionCookie(token);
  await audit(session.userId, 'auth.password_change', session.username);
  return ok({ message: 'Password changed. Other sessions have been signed out.' });
}
