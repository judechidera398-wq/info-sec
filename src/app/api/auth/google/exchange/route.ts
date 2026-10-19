import { exchangeMobileOAuthTicket, fail, isSameOrigin, ok } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return fail('Origin not allowed', 403);
  const body = await request.json().catch(() => null) as { ticket?: unknown; verifier?: unknown } | null;
  if (typeof body?.ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.ticket)
      || typeof body.verifier !== 'string' || !/^[a-f0-9]{64}$/.test(body.verifier)) {
    return fail('Google sign-in could not be completed.', 400);
  }
  const result = await exchangeMobileOAuthTicket(body.ticket, body.verifier);
  if (!result) return fail('Google sign-in expired. Please try again.', 401);
  return ok(result);
}
