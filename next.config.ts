import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3', 'argon2'],
  poweredByHeader: false,
};

export default nextConfig;
