import { existsSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';

// One .env at the repo root serves the contracts, the node and this app.
const rootEnv = path.resolve(process.cwd(), '../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@elysian/core'],
  turbopack: {},
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  async headers() {
    return [
      {
        source: '/circuits/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
