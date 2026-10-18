-- Fictional demonstration records for a non-production/test database.
-- Run schema.sql first. Re-running this file does not duplicate demo books, members, or sample loans.
BEGIN;

INSERT INTO books(isbn,title,author,category,publisher,publication_year,copies_total,copies_available)
VALUES
  ('DEMO-ISBN-001','The Pragmatic Programmer','Andrew Hunt and David Thomas','Software','Addison-Wesley',1999,4,4),
  ('DEMO-ISBN-002','Clean Code','Robert C. Martin','Software','Prentice Hall',2008,4,4),
  ('DEMO-ISBN-003','Designing Data-Intensive Applications','Martin Kleppmann','Software','O''Reilly Media',2017,3,3),
  ('DEMO-ISBN-004','The Hobbit','J. R. R. Tolkien','Fantasy','George Allen & Unwin',1937,5,5),
  ('DEMO-ISBN-005','Pride and Prejudice','Jane Austen','Classic','T. Egerton',1813,3,3),
  ('DEMO-ISBN-006','Things Fall Apart','Chinua Achebe','African Literature','Heinemann',1958,4,4),
  ('DEMO-ISBN-007','A Brief History of Time','Stephen Hawking','Science','Bantam Books',1988,2,2),
  ('DEMO-ISBN-008','The Little Prince','Antoine de Saint-Exupery','Children','Reynal & Hitchcock',1943,3,3)
ON CONFLICT (isbn) DO NOTHING;

INSERT INTO library_members(member_code,full_name,email,phone)
VALUES
  ('DEMO-M001','Demo Member One','member.one@example.invalid',''),
  ('DEMO-M002','Demo Member Two','member.two@example.invalid',''),
  ('DEMO-M003','Demo Member Three','member.three@example.invalid',''),
  ('DEMO-M004','Demo Member Four','member.four@example.invalid',''),
  ('DEMO-M005','Demo Member Five','member.five@example.invalid',''),
  ('DEMO-M006','Demo Member Six','member.six@example.invalid','')
ON CONFLICT (member_code) DO NOTHING;

-- Current and overdue examples. No staff identity is fabricated; checked_out_by is nullable.
INSERT INTO loans(book_id,member_id,due_at)
SELECT b.id,m.id,CURRENT_DATE + sample.days_until_due
FROM (VALUES
  ('DEMO-ISBN-001','DEMO-M001',14),
  ('DEMO-ISBN-002','DEMO-M002',-5),
  ('DEMO-ISBN-004','DEMO-M003',7)
) AS sample(isbn,member_code,days_until_due)
JOIN books b ON b.isbn=sample.isbn
JOIN library_members m ON m.member_code=sample.member_code
WHERE NOT EXISTS (
  SELECT 1 FROM loans prior WHERE prior.book_id=b.id AND prior.member_id=m.id
);

-- One historical returned example.
INSERT INTO loans(book_id,member_id,due_at,checked_out_at,returned_at)
SELECT b.id,m.id,CURRENT_DATE - 30,NOW()-INTERVAL '30 days',NOW()-INTERVAL '27 days'
FROM books b CROSS JOIN library_members m
WHERE b.isbn='DEMO-ISBN-006' AND m.member_code='DEMO-M004'
  AND NOT EXISTS (
    SELECT 1 FROM loans prior WHERE prior.book_id=b.id AND prior.member_id=m.id
  );

-- Reconcile only the specially marked demo books with their open loan rows.
UPDATE books b
SET copies_available=GREATEST(0,b.copies_total-(
  SELECT COUNT(*)::int FROM loans l WHERE l.book_id=b.id AND l.returned_at IS NULL
)),updated_at=NOW()
WHERE b.isbn LIKE 'DEMO-ISBN-%';

COMMIT;

SELECT
  (SELECT COUNT(*) FROM books WHERE isbn LIKE 'DEMO-ISBN-%') AS demo_books,
  (SELECT COUNT(*) FROM library_members WHERE member_code LIKE 'DEMO-M%') AS demo_members,
  (SELECT COUNT(*) FROM loans l JOIN books b ON b.id=l.book_id WHERE b.isbn LIKE 'DEMO-ISBN-%') AS demo_loans;
