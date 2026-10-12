import 'server-only';
import { cookies } from 'next/headers';
import { randomBytes } from 'node:crypto';
import { one, run, transaction } from './db';
import { appOrigin, cookieSecure } from './env';
import { keyedDigest, randomToken, tokenDigest } from './security';

const COOKIE = 'local_access_session';
const SESSION_SECONDS = 30 * 60;
export type Role = 'admin' | 'computer_admin' | 'manager' | 'user';
export type AuthSession = {
  sessionId: number; userId: number; username: string; role: Role;
  active: number; sessionVersion: number; stage: 'pending' | 'active';
};

export function fail(message: string, status = 400) {
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function ok(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function isSameOrigin(request: Request): boolean {
  return request.headers.get('origin')?.replace(/\/$/, '') === appOrigin;
}

export async function putSessionCookie(token: string) {
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, secure: cookieSecure, sameSite: 'strict', path: '/', maxAge: SESSION_SECONDS,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(COOKIE);
}

export async function createPendingSession(userId: number, version: number): Promise<{ id: number; token: string }> {
  const token = randomToken();
  const now = Math.floor(Date.now() / 1000);
  const id = await transaction(async (client) => {
    await client.query('DELETE FROM sessions WHERE expires_at<$1', [now]);
    const result = await client.query<{ id: string }>(`INSERT INTO sessions(token_hash,user_id,session_version,stage,expires_at)
      VALUES($1,$2,$3,'pending',$4) RETURNING id`, [tokenDigest(token), userId, version, now + SESSION_SECONDS]);
    return Number(result.rows[0].id);
  });
  return { id, token };
}

export async function getSession(): Promise<AuthSession | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const session = await one<AuthSession & { expiresAt: number; currentVersion: number }>(`SELECT s.id AS "sessionId",s.user_id AS "userId",s.session_version AS "sessionVersion",
      s.stage,s.expires_at AS "expiresAt",u.username,u.role,u.active,u.session_version AS "currentVersion"
    FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1`, [tokenDigest(token)]);
  if (!session || session.expiresAt < Math.floor(Date.now() / 1000)
      || !session.active || session.sessionVersion !== session.currentVersion) {
    if (session) await run('DELETE FROM sessions WHERE id=$1', [session.sessionId]);
    await clearSessionCookie();
    return null;
  }
  return session;
}

export async function rotateToActive(sessionId: number, userId: number, version: number): Promise<string> {
  const token = randomToken();
  const now = Math.floor(Date.now() / 1000);
  await transaction(async (client) => {
    await client.query('DELETE FROM sessions WHERE user_id=$1 AND id<>$2', [userId, sessionId]);
    await client.query(`UPDATE sessions SET token_hash=$1,stage='active',session_version=$2,expires_at=$3 WHERE id=$4`,
      [tokenDigest(token), version, now + SESSION_SECONDS, sessionId]);
    await client.query('DELETE FROM pending_mfa WHERE session_id=$1', [sessionId]);
  });
  return token;
}

export async function rotateActiveSession(sessionId: number, userId: number, version: number): Promise<string> {
  const token = randomToken();
  const now = Math.floor(Date.now() / 1000);
  await transaction(async (client) => {
    await client.query('DELETE FROM sessions WHERE user_id=$1 AND id<>$2', [userId, sessionId]);
    await client.query(`UPDATE sessions SET token_hash=$1,stage='active',session_version=$2,expires_at=$3 WHERE id=$4`,
      [tokenDigest(token), version, now + SESSION_SECONDS, sessionId]);
  });
  return token;
}

export async function revokeSession(sessionId: number) {
  await run('DELETE FROM sessions WHERE id=$1', [sessionId]);
}

export async function addAttempt(username: string, success: boolean) {
  const normalized = username.trim().toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  await transaction(async (client) => {
    await client.query('INSERT INTO login_attempts(username,attempted_at,success) VALUES($1,$2,$3)', [normalized, now, Number(success)]);
    await client.query('DELETE FROM login_attempts WHERE attempted_at<$1', [now - 86400]);
  });
}

export async function isRateLimited(username: string): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const row = await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM login_attempts
    WHERE username=$1 AND success=0 AND attempted_at>$2`, [username.trim().toLowerCase(), now - 900]);
  return (row?.n ?? 0) >= 8;
}

export async function audit(actorId: number | null, action: string, target: string | null, outcome = 'success') {
  await run('INSERT INTO audit_events(actor_id,action,target,outcome) VALUES($1,$2,$3,$4)', [actorId, action, target, outcome]);
}

export async function generateRecoveryCodes(userId: number): Promise<string[]> {
  const codes = Array.from({ length: 8 }, () => randomBytes(10).toString('base64url'));
  await transaction(async (client) => {
    await client.query('DELETE FROM recovery_codes WHERE user_id=$1', [userId]);
    for (const code of codes) await client.query('INSERT INTO recovery_codes(user_id,code_hash) VALUES($1,$2)', [userId, keyedDigest(code, 'recovery')]);
  });
  return codes;
}

export async function consumeRecoveryCode(userId: number, code: string): Promise<boolean> {
  const digest = keyedDigest(code, 'recovery');
  return transaction(async (client) => {
    const row = await client.query<{ id: string }>('SELECT id FROM recovery_codes WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL FOR UPDATE', [userId, digest]);
    if (!row.rows[0]) return false;
    await client.query('UPDATE recovery_codes SET used_at=NOW() WHERE id=$1', [row.rows[0].id]);
    return true;
  });
}

export function hasRole(session: AuthSession, ...roles: Role[]): boolean {
  return session.stage === 'active' && roles.includes(session.role);
}

export function assertRole(session: AuthSession, ...roles: Role[]): Response | null {
  return hasRole(session, ...roles) ? null : fail('Insufficient role', session.stage !== 'active' ? 401 : 403);
}
