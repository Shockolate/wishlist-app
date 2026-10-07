import type { NextConfig } from 'next';

/**
 * Where /api/* is proxied (spec §3). Required whenever the config loads: Next compiles rewrite
 * destinations into the build output, so a missing value would ship a site whose every API call
 * 404s.
 */
function readApiOrigin(): string {
  const value = process.env.API_ORIGIN;
  if (!value) {
    throw new Error(
      'API_ORIGIN must be set (e.g. http://localhost:3001) to build or start the web app',
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`API_ORIGIN is not a valid URL: ${value}`);
  }
  if (url.origin !== value) {
    throw new Error(
      `API_ORIGIN must be a bare origin with no path or trailing slash, got: ${value}`,
    );
  }
  return value;
}

const API_ORIGIN = readApiOrigin();

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Inlined at build so server code calls exactly the API the rewrite points at.
  env: { API_ORIGIN },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
