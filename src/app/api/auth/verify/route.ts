import { addAttempt, audit, consumeRecoveryCode, fail, getSession, isRateLimited, isSameOrigin, ok, putSessionCookie, rotateToActive } from '@/lib/auth';
import { one } from '@/lib/db';
import { getEncryptedTotp, validTotp } from '@/lib/mfa';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return fail('Origin not allowed', 403);
  const session = await getSession();
  if (!session || session.stage !== 'pending') return fail('Complete password sign-in first', 401);
  const body = await request.json().catch(() => null) as { code?: unknown } | null;
  const code = typeof body?.code === 'string' ? body.code.trim().replace(/\s/g, '') : '';
  if (await isRateLimited(session.username)) return fail('Too many attempts. Try again in 15 minutes.', 429);
  const user = await one<{totp_secret:string|null;session_version:number}>('SELECT totp_secret,session_version FROM users WHERE id=$1 AND active=1', [session.userId]);
  if (!user || !user.totp_secret || user.session_version !== session.sessionVersion) return fail('Set up two-factor authentication first', 401);
  const secret = await getEncryptedTotp(session.userId);
  let valid = !!secret && validTotp(secret, code);
  if (!valid && code.length >= 10) valid = await consumeRecoveryCode(session.userId, code);
  await addAttempt(session.username, valid);
  if (!valid) {
    await audit(session.userId, 'auth.mfa', session.username, 'failure');
    return fail('Invalid verification code', 401);
  }
  const token = await rotateToActive(session.sessionId, session.userId, session.sessionVersion);
  await putSessionCookie(token);
  await audit(session.userId, 'auth.mfa', session.username);
  return ok({ message: 'Signed in' });
}
