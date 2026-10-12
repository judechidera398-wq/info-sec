import argon2 from 'argon2';
import { createHmac } from 'node:crypto';
import { createPool } from './supabase-db.mjs';

function hidden(label) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    process.stdout.write(label);
    input.setRawMode(true);
    input.resume();
    let value = '';
    const onData = (chunk) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\u0003') { cleanup(); reject(new Error('Cancelled')); return; }
        if (char === '\r' || char === '\n') { cleanup(); process.stdout.write('\n'); resolve(value); return; }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    };
    const cleanup = () => { input.removeListener('data', onData); input.setRawMode(false); input.pause(); };
    input.on('data', onData);
  });
}

async function main() {
  const username = process.argv[2] || '';
  if (!/^[A-Za-z0-9_.-]{3,64}$/.test(username)) {
    console.error('Usage: node scripts/create-admin.mjs <username> (3-64 letters, numbers, dots, underscores or hyphens)');
    process.exitCode = 2;
    return;
  }
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    console.error('Run this command in an interactive terminal so passwords can be entered without echo.');
    process.exitCode = 2;
    return;
  }

  const password = await hidden('Admin password (12+ characters): ');
  const again = await hidden('Confirm password: ');
  if (password.length < 12 || password.length > 256) {
    console.error('Password must be 12-256 characters.'); process.exitCode = 2; return;
  }
  if (password !== again) { console.error('Passwords did not match.'); process.exitCode = 2; return; }

  const pepper = process.env.AUTH_PEPPER;
  if (!pepper || Buffer.byteLength(pepper) < 32) {
    console.error('Set AUTH_PEPPER to a separate random secret of at least 32 bytes.'); process.exitCode = 2; return;
  }

  const material = createHmac('sha256', pepper).update(`password:${password}`).digest('hex');
  const hash = await argon2.hash(material, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 2 });
  const pool = createPool();
  try {
    const prior = await pool.query("SELECT id FROM users WHERE role='admin' AND active=1 LIMIT 1");
    if (prior.rowCount) { console.error('An active administrator already exists.'); process.exitCode = 1; return; }
    await pool.query('BEGIN');
    const result = await pool.query("INSERT INTO users(username,password_hash,role) VALUES($1,$2,'admin') RETURNING id", [username, hash]);
    await pool.query('INSERT INTO audit_events(actor_id,action,target,outcome) VALUES($1,$2,$3,$4)',
      [result.rows[0].id, 'admin.bootstrap', username, 'success']);
    await pool.query('COMMIT');
    console.log(`Created administrator ${username}. Enroll an authenticator at first sign-in.`);
  } catch (error) {
    await pool.query('ROLLBACK').catch(() => {});
    if (error?.code === '23505') { console.error('That username is already in use.'); process.exitCode = 1; }
    else { console.error('Could not create administrator in Supabase.'); if (error instanceof Error) console.error(error.message); process.exitCode = 1; }
  } finally {
    await pool.end();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'Could not create administrator.'); process.exitCode = 1; });
