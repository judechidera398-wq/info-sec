import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type EncryptedBackup = {
  format: 'vault-library-backup';
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
};

function key(): Buffer {
  const encoded = process.env.BACKUP_ENCRYPTION_KEY?.trim();
  if (!encoded) throw new Error('BACKUP_ENCRYPTION_KEY is not configured');
  const value = Buffer.from(encoded, 'base64');
  if (value.length !== 32) throw new Error('BACKUP_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  return value;
}

export function encryptBackup(data: unknown): EncryptedBackup {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return {
    format: 'vault-library-backup', version: 1,
    iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: encrypted.toString('base64url'),
  };
}

export function decryptBackup(value: unknown): unknown {
  if (!value || typeof value !== 'object') throw new Error('Backup envelope is invalid');
  const envelope = value as Partial<EncryptedBackup>;
  if (envelope.format !== 'vault-library-backup' || envelope.version !== 1
      || typeof envelope.iv !== 'string' || typeof envelope.tag !== 'string' || typeof envelope.ciphertext !== 'string'
      || envelope.ciphertext.length > 20_000_000) throw new Error('Backup file format is not supported');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(envelope.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
  const plain = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  return JSON.parse(plain) as unknown;
}
