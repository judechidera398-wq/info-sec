import { assertRole, audit, fail, getSession, isSameOrigin, ok, type Role } from '@/lib/auth';
import { one, run, transaction } from '@/lib/db';

export const runtime = 'nodejs';
const staff: Role[] = ['admin', 'manager', 'inputer'];

export async function PATCH(request: Request, context: {params: Promise<{id:string}>}) {
  if (!isSameOrigin(request)) return fail('Origin not allowed', 403);
  const session = await getSession();
  if (!session) return fail('Sign in required', 401);
  const denied = assertRole(session, ...staff);
  if (denied) return denied;
  const id = Number((await context.params).id);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const author = typeof body?.author === 'string' ? body.author.trim() : '';
  const category = typeof body?.category === 'string' ? body.category.trim() : 'General';
  const publisher = typeof body?.publisher === 'string' ? body.publisher.trim() : '';
  const isbn = typeof body?.isbn === 'string' ? body.isbn.trim() : '';
  const year = body?.publication_year === '' || body?.publication_year === null ? null : Number(body?.publication_year);
  const copies = Number(body?.copies_total);
  if (!Number.isSafeInteger(id) || id < 1 || !title || title.length > 200 || !author || author.length > 160
      || category.length > 80 || publisher.length > 160 || isbn.length > 32
      || (year !== null && (!Number.isInteger(year) || year < 1000 || year > 2200))
      || !Number.isInteger(copies) || copies < 0 || copies > 10000) return fail('Check the book details and try again.');
  try {
    const result = await transaction(async (client) => {
      const current = await client.query<{copies_total:number;copies_available:number}>('SELECT copies_total,copies_available FROM books WHERE id=$1 FOR UPDATE', [id]);
      if (!current.rows[0]) return {missing:true as const};
      const checkedOut = current.rows[0].copies_total - current.rows[0].copies_available;
      if (copies < checkedOut) return {conflict:true as const};
      await client.query(`UPDATE books SET isbn=$1,title=$2,author=$3,category=$4,publisher=$5,publication_year=$6,
        copies_total=$7,copies_available=$8,updated_at=NOW() WHERE id=$9`,
        [isbn || null,title,author,category || 'General',publisher,year,copies,copies-checkedOut,id]);
      return {updated:true as const};
    });
    if ('missing' in result) return fail('Book not found', 404);
    if ('conflict' in result) return fail('Total copies cannot be lower than the number currently on loan.', 409);
    await audit(session.userId, 'book.update', String(id));
    return ok({message:'Book updated'});
  } catch (error) {
    if ((error as {code?:string})?.code === '23505') return fail('That ISBN is already in the catalogue.', 409);
    throw error;
  }
}

export async function DELETE(request: Request, context: {params: Promise<{id:string}>}) {
  if (!isSameOrigin(request)) return fail('Origin not allowed', 403);
  const session = await getSession();
  if (!session) return fail('Sign in required', 401);
  const denied = assertRole(session, 'admin');
  if (denied) return denied;
  const id = Number((await context.params).id);
  if (!Number.isSafeInteger(id) || id < 1) return fail('Invalid book id');
  try {
    const count = await run('DELETE FROM books WHERE id=$1', [id]);
    if (!count) return fail('Book not found', 404);
    await audit(session.userId, 'book.delete', String(id));
    return ok({message:'Book deleted'});
  } catch (error) {
    if ((error as {code?:string})?.code === '23503') return fail('Books with loan history cannot be deleted.', 409);
    throw error;
  }
}
