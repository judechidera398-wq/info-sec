import 'server-only';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

const globalForDb = globalThis as unknown as { supabasePool?: Pool };

function pool(): Pool {
  if (globalForDb.supabasePool) return globalForDb.supabasePool;
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error('Set DATABASE_URL to your Supabase Postgres connection string. See README.md.');
  const caPath = process.env.DATABASE_CA_CERT_PATH?.trim();
  const caValue = process.env.DATABASE_CA_CERT?.trim().replace(/\\n/g, '\n');
  const url = new URL(connectionString);
  for (const option of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'sslpassword']) url.searchParams.delete(option);

  const instance = new Pool({
    connectionString: url.toString(),
    ssl: {
      rejectUnauthorized: true,
      ...(caValue ? { ca: caValue } : caPath ? { ca: readFileSync(caPath, 'utf8') } : {}),
    },
    max: process.env.VERCEL ? 1 : 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  instance.on('error', (error) => console.error('Supabase Postgres idle connection error:', error.message));
  globalForDb.supabasePool = instance;
  return instance;
}

export async function all<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  return (await pool().query(text, values)).rows as T[];
}

export async function one<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T | undefined> {
  return (await pool().query(text, values)).rows[0] as T | undefined;
}

export async function run(text: string, values: unknown[] = []): Promise<number> {
  return (await pool().query(text, values)).rowCount ?? 0;
}

export async function transaction<T>(work: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
