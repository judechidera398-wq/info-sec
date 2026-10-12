import { addAttempt, audit, fail, generateRecoveryCodes, getSession, isRateLimited, isSameOrigin, ok, putSessionCookie, rotateToActive } from '@/lib/auth';
import { one, run } from '@/lib/db';
import { pendingSeed, qrDataUrl, setupPayload, validTotp } from '@/lib/mfa';
import { encryptSecret } from '@/lib/security';

export const runtime = 'nodejs';

export async function GET() {
  const session = await getSession();
  if (!session || session.stage !== 'pending') return fail('Complete password sign-in first', 401);
  const user = await one<{totp_secret:string|null}>('SELECT totp_secret FROM users WHERE id=$1 AND active=1', [session.userId]);
  if (!user || user.totp_secret) return fail('MFA setup is not available', 409);
  if (await isRateLimited(session.username)) return fail('Too many attempts. Try again in 15 minutes.', 429);
  const setup = await setupPayload(session.username, session.sessionId);
  return ok({ secret: setup.secret, qr: await qrDataUrl(setup.uri) });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return fail('Origin not allowed', 403);
  const session = await getSession();
  if (!session || session.stage !== 'pending') return fail('Complete password sign-in first', 401);
  const body = await request.json().catch(() => null) as { code?: unknown } | null;
  const code = typeof body?.code === 'string' ? body.code.replace(/\s/g, '') : '';
  const user = await one<{totp_secret:string|null;session_version:number}>('SELECT totp_secret,session_version FROM users WHERE id=$1 AND active=1', [session.userId]);
  if (!user || user.totp_secret || user.session_version !== session.sessionVersion) return fail('MFA setup is not available', 409);
  if (await isRateLimited(session.username)) return fail('Too many attempts. Try again in 15 minutes.', 429);
  const seed = await pendingSeed(session.sessionId);
  if (!seed || !validTotp(seed, code)) {
    await addAttempt(session.username, false);
    return fail('Code did not match');
  }
  const recoveryCodes = await generateRecoveryCodes(session.userId);
  await run('UPDATE users SET totp_secret=$1 WHERE id=$2', [encryptSecret(seed), session.userId]);
  await addAttempt(session.username, true);
  const token = await rotateToActive(session.sessionId, session.userId, session.sessionVersion);
  await putSessionCookie(token);
  await audit(session.userId, 'auth.mfa_enroll', session.username);
  return ok({ message: 'Two-factor authentication enabled', recoveryCodes });
}
