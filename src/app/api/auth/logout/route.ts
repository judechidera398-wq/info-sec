import { clearSessionCookie, fail, getSession, isSameOrigin, ok, revokeSession } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return fail('Origin not allowed', 403);
  const session = await getSession();
  if (session) await revokeSession(session.sessionId);
  await clearSessionCookie();
  return ok({ message: 'Signed out' });
}
