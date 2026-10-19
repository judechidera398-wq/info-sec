import { timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { audit, createMobileOAuthTicket, createPendingSession, putSessionCookie } from '@/lib/auth';
import { one } from '@/lib/db';
import { appOrigin, cookieSecure } from '@/lib/env';
import { randomToken } from '@/lib/security';

export const runtime = 'nodejs';

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const oauthCookies = ['google_oauth_state', 'google_oauth_nonce', 'google_oauth_verifier', 'google_oauth_mobile', 'google_oauth_mobile_challenge'] as const;
const issuer = ['https://accounts.google.com', 'accounts.google.com'];

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function clearOauthCookies(response: NextResponse) {
  for (const name of oauthCookies) {
    response.cookies.set(name, '', {
      httpOnly: true, secure: cookieSecure, sameSite: 'lax',
      path: '/api/auth/google/callback', maxAge: 0,
    });
  }
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

function failedRedirect(mobile = false, error = 'failed') {
  const target = mobile
    ? new URL(`vaultofvalue://oauth/callback?error=${encodeURIComponent(error)}`)
    : new URL(`/?google=${encodeURIComponent(error)}`, appOrigin);
  return clearOauthCookies(NextResponse.redirect(target));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams;
  const cookieStore = await cookies();
  const savedState = cookieStore.get('google_oauth_state')?.value;
  const nonce = cookieStore.get('google_oauth_nonce')?.value;
  const verifier = cookieStore.get('google_oauth_verifier')?.value;
  const mobile = cookieStore.get('google_oauth_mobile')?.value === '1';
  const handoffChallenge = cookieStore.get('google_oauth_mobile_challenge')?.value ?? '';
  const state = query.get('state') || '';
  const code = query.get('code') || '';

  if (!savedState || !nonce || !verifier || !sameSecret(savedState, state) || !code || code.length > 4096 || query.has('error')) {
    await audit(null, 'auth.google', null, 'failure');
    return failedRedirect(mobile);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return failedRedirect(mobile, 'unconfigured');

  let stage = 'google_token_exchange';
  try {
    const redirectUri = `${appOrigin}/api/auth/google/callback`;
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenResponse.ok) {
      throw Object.assign(new Error('Google token exchange failed'), { code: `GOOGLE_TOKEN_HTTP_${tokenResponse.status}` });
    }
    const tokenBody = await tokenResponse.json() as { id_token?: unknown };
    if (typeof tokenBody.id_token !== 'string' || tokenBody.id_token.length > 16_384) throw new Error('Missing Google identity token');

    stage = 'identity_token_validation';
    const { payload } = await jwtVerify(tokenBody.id_token, googleKeys, {
      issuer,
      audience: clientId,
      algorithms: ['RS256'],
      clockTolerance: 5,
    });
    if (typeof payload.sub !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(payload.sub)
        || payload.email_verified !== true || typeof payload.email !== 'string'
        || typeof payload.nonce !== 'string' || !sameSecret(nonce, payload.nonce)) {
      throw new Error('Google identity claims were not accepted');
    }

    stage = 'account_lookup';
    let user = await one<{ id: number; username: string; active: number; session_version: number; totp_secret: string | null }>(
      'SELECT id,username,active,session_version,totp_secret FROM users WHERE google_sub=$1', [payload.sub]);

    if (!user) {
      stage = 'account_creation';
      const emailName = payload.email.split('@')[0].replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^[^A-Za-z0-9]+/, '').slice(0, 35) || 'user';
      const username = `g_${emailName}_${payload.sub.slice(-8)}`;
      const passwordPlaceholder = `google-oauth$${randomToken()}`;
      const result = await one<{id:number}>(`INSERT INTO users(username,password_hash,google_sub,role)
        VALUES($1,$2,$3,'user') RETURNING id`, [username, passwordPlaceholder, payload.sub]);
      user = {
        id: result!.id, username, active: 1,
        session_version: 0, totp_secret: null,
      };
      await audit(user.id, 'account.google_register', user.username);
    }

    if (!user.active) {
      await audit(user.id, 'auth.google', user.username, 'failure');
      return failedRedirect(mobile);
    }

    stage = 'session_creation';
    const session = await createPendingSession(user.id, user.session_version);
    await audit(user.id, 'auth.google', user.username);
    if (mobile) {
      if (!/^[a-f0-9]{64}$/.test(handoffChallenge)) return failedRedirect(true);
      const ticket = await createMobileOAuthTicket(session.id, handoffChallenge);
      const target = new URL('vaultofvalue://oauth/callback');
      target.searchParams.set('ticket', ticket);
      return clearOauthCookies(NextResponse.redirect(target));
    }
    await putSessionCookie(session.token);
    const step = user.totp_secret ? 'verify' : 'setup';
    return clearOauthCookies(NextResponse.redirect(new URL(`/?google=${step}`, appOrigin)));
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      && typeof error.code === 'string' ? error.code : undefined;
    console.error('Google OAuth callback failed', {
      stage,
      errorName: error instanceof Error ? error.name : 'UnknownError',
      ...(code ? { code } : {}),
    });
    await audit(null, 'auth.google', null, 'failure');
    return failedRedirect(mobile);
  }
}
