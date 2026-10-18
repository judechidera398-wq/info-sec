import { assertRole, audit, fail, getSession, isSameOrigin, ok, type Role } from '@/lib/auth';
import { transaction } from '@/lib/db';

export const runtime = 'nodejs';
const staff: Role[] = ['admin','manager','inputer'];

export async function PATCH(request: Request, context: {params: Promise<{id:string}>}) {
  if (!isSameOrigin(request)) return fail('Origin not allowed', 403);
  const session = await getSession();
  if (!session) return fail('Sign in required', 401);
  const denied = assertRole(session, ...staff);
  if (denied) return denied;
  const id = Number((await context.params).id);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const code = typeof body?.member_code === 'string' ? body.member_code.trim().toUpperCase() : '';
  const name = typeof body?.full_name === 'string' ? body.full_name.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
  const active = body?.active === false || body?.active === 0 ? 0 : body?.active === true || body?.active === 1 ? 1 : -1;
  if (!Number.isSafeInteger(id) || id < 1 || !/^[A-Z0-9-]{2,32}$/.test(code) || !name || name.length > 160 || email.length > 254 || phone.length > 40 || active < 0) return fail('Check the member details and try again.');
  try {
    const result=await transaction(async(client)=>{
      const existing=await client.query('SELECT id FROM library_members WHERE id=$1 FOR UPDATE',[id]);
      if(!existing.rows[0])return {missing:true as const};
      if(!active){
        const open=await client.query<{count:number}>('SELECT COUNT(*)::int AS count FROM loans WHERE member_id=$1 AND returned_at IS NULL',[id]);
        if((open.rows[0]?.count??0)>0)return {hasOpenLoans:true as const};
      }
      await client.query(`UPDATE library_members SET member_code=$1,full_name=$2,email=$3,phone=$4,active=$5,updated_at=NOW() WHERE id=$6`,
        [code,name,email,phone,active,id]);
      return {updated:true as const};
    });
    if('missing' in result)return fail('Member not found',404);
    if('hasOpenLoans' in result)return fail('Return this member’s active loans before deactivating the account.',409);
    await audit(session.userId, 'member.update', code);
    return ok({message:'Member updated'});
  } catch (error) {
    if ((error as {code?:string})?.code === '23505') return fail('That member number is already in use.', 409);
    throw error;
  }
}
