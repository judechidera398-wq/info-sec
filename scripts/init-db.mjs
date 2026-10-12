import { readFile } from 'node:fs/promises';
import { createPool } from './supabase-db.mjs';

const pool = createPool();
try {
  const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  await pool.query(schema);
  console.log('Supabase schema is ready.');
} catch (error) {
  console.error('Could not initialize the Supabase schema. Check DATABASE_URL and the project connection settings.');
  if (error instanceof Error) console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
