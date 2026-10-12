import { getSession, fail, ok } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET() {
  const session = await getSession();
  if (!session || session.stage !== 'active') return fail('Sign in required', 401);
  return ok({ id: session.userId, username: session.username, role: session.role });
}
