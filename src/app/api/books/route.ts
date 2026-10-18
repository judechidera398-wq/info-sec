import { assertRole, audit, fail, getSession, isSameOrigin, ok, type Role } from '@/lib/auth';
import { all, one } from '@/lib/db';

export const runtime = 'nodejs';
const staff: Role[] = ['admin', 'manager', 'inputer'];

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return fail('Sign in required', 401);
  const query = new URL(request.url).searchParams.get('q')?.trim().slice(0, 100) || '';
  const rows = await all(`SELECT id,isbn,title,author,category,publisher,publication_year,copies_total,copies_available,created_at,updated_at
    FROM books WHERE $1='' OR title ILIKE '%' || $1 || '%' OR author ILIKE '%' || $1 || '%'
      OR category ILIKE '%' || $1 || '%' OR COALESCE(isbn,'') ILIKE '%' || $1 || '%'
    ORDER BY title,id LIMIT 250`, [query]);
  return ok(rows);
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return fail('Origin not allowed', 403);
  const session = await getSession();
  if (!session) return fail('Sign in required', 401);
  const denied = assertRole(session, ...staff);
  if (denied) return denied;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const author = typeof body?.author === 'string' ? body.author.trim() : '';
  const category = typeof body?.category === 'string' ? body.category.trim() : 'General';
  const publisher = typeof body?.publisher === 'string' ? body.publisher.trim() : '';
  const isbn = typeof body?.isbn === 'string' ? body.isbn.trim() : '';
  const year = body?.publication_year === '' || body?.publication_year === null ? null : Number(body?.publication_year);
  const copies = Number(body?.copies_total);
  if (!title || title.length > 200 || !author || author.length > 160 || category.length > 80 || publisher.length > 160
      || isbn.length > 32 || (year !== null && (!Number.isInteger(year) || year < 1000 || year > 2200))
      || !Number.isInteger(copies) || copies < 0 || copies > 10000) return fail('Check the book details and try again.');
  try {
    const result = await one<{id:number}>(`INSERT INTO books(isbn,title,author,category,publisher,publication_year,copies_total,copies_available,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8) RETURNING id`, [isbn || null,title,author,category || 'General',publisher,year,copies,session.userId]);
    await audit(session.userId, 'book.create', String(result?.id));
    return ok({id:result?.id}, 201);
  } catch (error) {
    if ((error as {code?:string})?.code === '23505') return fail('That ISBN is already in the catalogue.', 409);
    throw error;
  }
}
