import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { appOrigin, cookieSecure } from '@/lib/env';

export const runtime = 'nodejs';

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const MOBILE_REDIRECT = 'vaultofvalue://oauth/callback';
const cookieOptions = {
  httpOnly: true,
  secure: cookieSecure,
  sameSite: 'lax' as const,
  path: '/api/auth/google/callback',
  maxAge: 10 * 60,
};

export async function GET(request: Request) {
  const startUrl = new URL(request.url);
  const mobile = startUrl.searchParams.get('client') === 'mobile';
  const handoffChallenge = startUrl.searchParams.get('handoff_challenge') ?? '';
  if (mobile && !/^[a-f0-9]{64}$/.test(handoffChallenge)) {
    return NextResponse.redirect(new URL(`${MOBILE_REDIRECT}?error=invalid_request`));
  }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(mobile
      ? new URL(`${MOBILE_REDIRECT}?error=unconfigured`)
      : new URL('/?google=unconfigured', appOrigin));
  }

  const state = randomBytes(32).toString('base64url');
  const nonce = randomBytes(32).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const redirectUri = `${appOrigin}/api/auth/google/callback`;
  const authorization = new URL(GOOGLE_AUTH);
  authorization.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();

  const response = NextResponse.redirect(authorization);
  response.cookies.set('google_oauth_state', state, cookieOptions);
  response.cookies.set('google_oauth_nonce', nonce, cookieOptions);
  response.cookies.set('google_oauth_verifier', verifier, cookieOptions);
  if (mobile) {
    response.cookies.set('google_oauth_mobile', '1', cookieOptions);
    response.cookies.set('google_oauth_mobile_challenge', handoffChallenge, cookieOptions);
  }
  return response;
}
