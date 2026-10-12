import 'server-only';

function required(name: string, minimum = 32): string {
  const value = process.env[name];
  if (!value || Buffer.byteLength(value) < minimum) {
    throw new Error(`Set ${name} to a random secret of at least ${minimum} bytes. See README.md.`);
  }
  return value;
}

export const secrets = {
  pepper: required('AUTH_PEPPER'),
  mfaEncryption: required('MFA_ENCRYPTION_KEY'),
};

export const appOrigin = (process.env.APP_ORIGIN || 'http://127.0.0.1:3000').replace(/\/$/, '');
export const cookieSecure = appOrigin.startsWith('https://');
