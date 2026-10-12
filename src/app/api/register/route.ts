import { one } from '@/lib/db';
import { audit, fail, isSameOrigin, ok } from '@/lib/auth';
import { hashPassword } from '@/lib/security';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return fail('Origin not allowed', 403);
  const body = await request.json().catch(() => null) as { username?: unknown; password?: unknown } | null;
  if (typeof body?.username !== 'string' || !/^[A-Za-z0-9_.-]{3,64}$/.test(body.username)
      || typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 256) {
    return fail('Use a 3–64 character username and a password of at least 12 characters.');
  }
  try {
    const encoded = await hashPassword(body.password);
    const result = await one<{id:string}>('INSERT INTO users(username,password_hash) VALUES($1,$2) RETURNING id',
      [body.username, encoded]);
    await audit(Number(result?.id), 'account.register', body.username);
    return ok({ message: 'Account created. Sign in to set up two-factor authentication.' }, 201);
  } catch (error) {
    if ((error as {code?:string})?.code === '23505') return fail('Username is unavailable', 409);
    throw error;
  }
}
