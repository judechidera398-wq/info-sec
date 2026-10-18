import 'server-only';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import { one, run } from './db';
import { decryptSecret, encryptSecret } from './security';

export function newTotp(username: string) {
  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({
    issuer: 'Library Management', label: username, algorithm: 'SHA1', digits: 6, period: 30, secret,
  });
  return { base32: secret.base32, uri: totp.toString() };
}

export async function setupPayload(username: string, sessionId: number) {
  let prior = await one<{ seed_ciphertext: string }>('SELECT seed_ciphertext FROM pending_mfa WHERE session_id=$1', [sessionId]);
  if (prior) {
    const seed = decryptSecret(prior.seed_ciphertext);
    const totp = new OTPAuth.TOTP({ issuer: 'Library Management', label: username, algorithm: 'SHA1', digits: 6, period: 30,
      secret: OTPAuth.Secret.fromBase32(seed) });
    return { secret: seed, uri: totp.toString() };
  }
  const created = newTotp(username);
  await run('INSERT INTO pending_mfa(session_id,seed_ciphertext) VALUES($1,$2) ON CONFLICT(session_id) DO NOTHING',
    [sessionId, encryptSecret(created.base32)]);
  prior = await one<{ seed_ciphertext: string }>('SELECT seed_ciphertext FROM pending_mfa WHERE session_id=$1', [sessionId]);
  if (!prior) throw new Error('Could not store pending MFA setup.');
  const seed = decryptSecret(prior.seed_ciphertext);
  const totp = new OTPAuth.TOTP({ issuer: 'Library Management', label: username, algorithm: 'SHA1', digits: 6, period: 30,
    secret: OTPAuth.Secret.fromBase32(seed) });
  return { secret: seed, uri: totp.toString() };
}

export async function pendingSeed(sessionId: number): Promise<string | null> {
  const row = await one<{ seed_ciphertext: string }>('SELECT seed_ciphertext FROM pending_mfa WHERE session_id=$1', [sessionId]);
  return row ? decryptSecret(row.seed_ciphertext) : null;
}

export function validTotp(seed: string, code: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const totp = new OTPAuth.TOTP({ issuer: 'Library Management', label: 'account', algorithm: 'SHA1', digits: 6, period: 30,
    secret: OTPAuth.Secret.fromBase32(seed) });
  return totp.validate({ token: code, window: 1 }) !== null;
}

export async function getEncryptedTotp(userId: number): Promise<string | null> {
  const row = await one<{ totp_secret: string | null }>('SELECT totp_secret FROM users WHERE id=$1', [userId]);
  return row?.totp_secret ? decryptSecret(row.totp_secret) : null;
}

export async function qrDataUrl(uri: string): Promise<string> {
  return QRCode.toDataURL(uri, { margin: 1, width: 220, color: { dark: '#183b35', light: '#ffffff' } });
}
