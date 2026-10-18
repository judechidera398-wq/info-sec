import { assertRole, audit, fail, getSession, isSameOrigin, ok, type Role } from '@/lib/auth';
import { all, one } from '@/lib/db';

export const runtime = 'nodejs';
const staff: Role[] = ['admin','manager','inputer'];

export async function GET() {
  const session = await getSession();
  if (!session) return fail('Sign in required', 401);
  const denied = assertRole(session, ...staff);
  if (denied) return denied;
  return ok(await all(`SELECT m.id,m.member_code,m.full_name,m.email,m.phone,m.active,m.created_at,
    COUNT(l.id) FILTER (WHERE l.returned_at IS NULL)::int AS active_loans
    FROM library_members m LEFT JOIN loans l ON l.member_id=m.id
    GROUP BY m.id ORDER BY m.full_name,m.id LIMIT 500`));
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return fail('Origin not allowed', 403);
  const session = await getSession();
  if (!session) return fail('Sign in required', 401);
  const denied = assertRole(session, ...staff);
  if (denied) return denied;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const code = typeof body?.member_code === 'string' ? body.member_code.trim().toUpperCase() : '';
  const name = typeof body?.full_name === 'string' ? body.full_name.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
  if (!/^[A-Z0-9-]{2,32}$/.test(code) || !name || name.length > 160 || email.length > 254 || phone.length > 40) return fail('Check the member details and try again.');
  try {
    const result = await one<{id:number}>(`INSERT INTO library_members(member_code,full_name,email,phone,created_by)
      VALUES($1,$2,$3,$4,$5) RETURNING id`, [code,name,email,phone,session.userId]);
    await audit(session.userId, 'member.create', code);
    return ok({id:result?.id}, 201);
  } catch (error) {
    if ((error as {code?:string})?.code === '23505') return fail('That member number is already in use.', 409);
    throw error;
  }
}
