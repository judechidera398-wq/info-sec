import 'server-only';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { secrets } from './env';

export function keyedDigest(value: string, purpose: string): string {
  return createHmac('sha256', secrets.pepper).update(`${purpose}:${value}`).digest('hex');
}

export async function hashPassword(password: string): Promise<string> {
  const material = keyedDigest(password, 'password');
  return argon2.hash(material, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 2 });
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  try { return await argon2.verify(encoded, keyedDigest(password, 'password')); }
  catch { return false; }
}

function encryptionKey(): Buffer {
  const key = Buffer.from(secrets.mfaEncryption, 'base64');
  if (key.length !== 32) throw new Error('MFA_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  return key;
}

export function encryptSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}

export function decryptSecret(encoded: string): string {
  const [ivText, tagText, dataText] = encoded.split('.');
  if (!ivText || !tagText || !dataText) throw new Error('Invalid encrypted MFA seed.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataText, 'base64url')), decipher.final()]).toString('utf8');
}

export function randomToken(): string { return randomBytes(32).toString('base64url'); }
export function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

