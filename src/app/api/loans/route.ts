import { assertRole, audit, fail, getSession, isSameOrigin, ok, type Role } from '@/lib/auth';
import { all, transaction } from '@/lib/db';

export const runtime = 'nodejs';
const staff: Role[] = ['admin','manager','inputer'];

export async function GET() {
  const session = await getSession();
  if (!session) return fail('Sign in required', 401);
  const denied = assertRole(session, ...staff);
  if (denied) return denied;
  return ok(await all(`SELECT l.id,l.book_id,l.member_id,l.checked_out_by,l.returned_by,l.checked_out_at,l.due_at,l.returned_at,
    b.title AS book_title,b.isbn,m.member_code,m.full_name AS member_name,
    CASE WHEN l.returned_at IS NOT NULL THEN 'returned' WHEN l.due_at < CURRENT_DATE THEN 'overdue' ELSE 'on_loan' END AS status
    FROM loans l JOIN books b ON b.id=l.book_id JOIN library_members m ON m.id=l.member_id
    ORDER BY l.returned_at NULLS FIRST,l.due_at,l.id DESC LIMIT 500`));
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return fail('Origin not allowed', 403);
  const session = await getSession();
  if (!session) return fail('Sign in required', 401);
  const denied = assertRole(session, ...staff);
  if (denied) return denied;
  const body = await request.json().catch(() => null) as {book_id?:unknown;member_id?:unknown;due_at?:unknown} | null;
  const bookId = Number(body?.book_id);
  const memberId = Number(body?.member_id);
  const dueAt = typeof body?.due_at === 'string' ? body.due_at : '';
  const dueTimestamp = Date.parse(`${dueAt}T00:00:00Z`);
  const today = new Date().toISOString().slice(0,10);
  const validDueDate = /^\d{4}-\d{2}-\d{2}$/.test(dueAt) && Number.isFinite(dueTimestamp)
    && new Date(dueTimestamp).toISOString().slice(0,10) === dueAt && dueAt >= today;
  if (!Number.isSafeInteger(bookId) || bookId < 1 || !Number.isSafeInteger(memberId) || memberId < 1 || !validDueDate) return fail('Select a book, member, and valid future due date.');
  const result = await transaction(async (client) => {
    const book = await client.query<{copies_available:number}>('SELECT copies_available FROM books WHERE id=$1 FOR UPDATE', [bookId]);
    if (!book.rows[0]) return {bookMissing:true as const};
    if (book.rows[0].copies_available < 1) return {unavailable:true as const};
    const member = await client.query<{active:number}>('SELECT active FROM library_members WHERE id=$1 FOR UPDATE', [memberId]);
    if (!member.rows[0]) return {memberMissing:true as const};
    if (!member.rows[0].active) return {memberInactive:true as const};
    const setting = await client.query<{limit:number}>("SELECT COALESCE((setting_value #>> '{}')::int,5) AS limit FROM system_settings WHERE setting_key='max_active_loans'");
    const limit = setting.rows[0]?.limit ?? 5;
    const current = await client.query<{count:number}>('SELECT COUNT(*)::int AS count FROM loans WHERE member_id=$1 AND returned_at IS NULL', [memberId]);
    if (current.rows[0].count >= limit) return {memberLimitReached:true as const,limit};
    await client.query('UPDATE books SET copies_available=copies_available-1,updated_at=NOW() WHERE id=$1', [bookId]);
    const loan = await client.query<{id:number}>('INSERT INTO loans(book_id,member_id,checked_out_by,due_at) VALUES($1,$2,$3,$4) RETURNING id',
      [bookId,memberId,session.userId,dueAt]);
    return {loanId:loan.rows[0].id};
  });
  if ('bookMissing' in result) return fail('Book not found', 404);
  if ('unavailable' in result) return fail('No copies are currently available.', 409);
  if ('memberMissing' in result) return fail('Member not found', 404);
  if ('memberInactive' in result) return fail('This member is inactive.', 409);
  if ('memberLimitReached' in result) return fail(`This member has reached the limit of ${result.limit} active loans.`, 409);
  await audit(session.userId, 'loan.checkout', String(result.loanId));
  return ok({id:result.loanId,message:'Book checked out'}, 201);
}
