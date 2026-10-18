import { assertRole, audit, fail, getSession, isSameOrigin, ok, type Role } from '@/lib/auth';
import { transaction } from '@/lib/db';

export const runtime = 'nodejs';
const staff: Role[] = ['admin','manager','inputer'];

export async function POST(request: Request, context: {params: Promise<{id:string}>}) {
  if (!isSameOrigin(request)) return fail('Origin not allowed', 403);
  const session = await getSession();
  if (!session) return fail('Sign in required', 401);
  const denied = assertRole(session, ...staff);
  if (denied) return denied;
  const id = Number((await context.params).id);
  if (!Number.isSafeInteger(id) || id < 1) return fail('Invalid loan id');
  const result = await transaction(async (client) => {
    const loan = await client.query<{book_id:number;returned_at:string|null}>('SELECT book_id,returned_at FROM loans WHERE id=$1 FOR UPDATE', [id]);
    if (!loan.rows[0]) return {missing:true as const};
    if (loan.rows[0].returned_at) return {returned:true as const};
    await client.query('UPDATE loans SET returned_at=NOW(),returned_by=$1 WHERE id=$2', [session.userId,id]);
    const book = await client.query('UPDATE books SET copies_available=copies_available+1,updated_at=NOW() WHERE id=$1 AND copies_available<copies_total', [loan.rows[0].book_id]);
    if (!book.rowCount) throw new Error('Book inventory is inconsistent; return transaction rolled back.');
    return {success:true as const};
  });
  if ('missing' in result) return fail('Loan not found', 404);
  if ('returned' in result) return fail('This loan has already been returned.', 409);
  await audit(session.userId, 'loan.return', String(id));
  return ok({message:'Book returned'});
}
