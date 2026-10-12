import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { appOrigin, cookieSecure } from '@/lib/env';

export const runtime = 'nodejs';

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const cookieOptions = {
  httpOnly: true,
  secure: cookieSecure,
  sameSite: 'lax' as const,
  path: '/api/auth/google/callback',
  maxAge: 10 * 60,
};

export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL('/?google=unconfigured', appOrigin));
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
  return response;
}
