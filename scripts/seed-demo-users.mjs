import { createHmac, randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { createPool } from './supabase-db.mjs';

if (process.env.DEMO_USERS_ENABLED !== 'true') {
  console.error('Refusing to create demo accounts. Set DEMO_USERS_ENABLED=true only for a disposable test database.');
  process.exit(1);
}

const pepper = process.env.AUTH_PEPPER;
if (!pepper || Buffer.byteLength(pepper) < 32) {
  console.error('AUTH_PEPPER must be set before demo accounts can be created.');
  process.exit(1);
}

const demoUsers = [
  { username: 'demo_admin', role: 'admin' },
  { username: 'demo_manager', role: 'manager' },
  { username: 'demo_inputer', role: 'inputer' },
  { username: 'demo_reader', role: 'user' },
];
const pool = createPool();
const created = [];

try {
  for (const user of demoUsers) {
    const exists = await pool.query('SELECT id FROM users WHERE LOWER(username)=LOWER($1)', [user.username]);
    if (exists.rowCount) {
      console.log(`${user.username}: already exists; left unchanged.`);
      continue;
    }
    const password = randomBytes(24).toString('base64url');
    const peppered = createHmac('sha256', pepper).update(`password:${password}`).digest('hex');
    const passwordHash = await argon2.hash(peppered, {
      type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 2,
    });
    await pool.query('INSERT INTO users(username,password_hash,role) VALUES($1,$2,$3)',
      [user.username, passwordHash, user.role]);
    created.push({ ...user, password });
  }

  if (created.length) {
    console.log('\nOne-time demo credentials (copy them now; passwords are not stored in plaintext):');
    for (const user of created) console.log(`${user.role}\t${user.username}\t${user.password}`);
    console.log('\nEach user must enroll in authenticator MFA on first sign-in.');
  } else {
    console.log('No accounts were created.');
  }
} catch (error) {
  console.error('Could not create demo accounts. Check that you initialized the test database schema.');
  if (error instanceof Error) console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
