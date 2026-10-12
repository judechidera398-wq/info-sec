import { existsSync, readFileSync } from 'node:fs';
import { Pool } from 'pg';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

export function createPool() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error('Set DATABASE_URL in .env.local to your Supabase Postgres connection string.');
  const caPath = process.env.DATABASE_CA_CERT_PATH?.trim();
  const url = new URL(connectionString);
  for (const option of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'sslpassword']) url.searchParams.delete(option);
  return new Pool({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true, ...(caPath ? { ca: readFileSync(caPath, 'utf8') } : {}) },
    max: 4,
    connectionTimeoutMillis: 10_000,
  });
}
