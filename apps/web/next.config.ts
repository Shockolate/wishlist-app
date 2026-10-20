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

/**
 * Cloudflare Turnstile's public site key (Plan 2b rule 11). Required, so a build can't ship a
 * widget that never renders. Outside production, use Cloudflare's always-pass test key.
 */
function readTurnstileSiteKey(): string {
  const value = process.env.TURNSTILE_SITE_KEY;
  if (!value) {
    throw new Error(
      'TURNSTILE_SITE_KEY must be set to build or start the web app (outside production, use the test key 1x00000000000000000000AA)',
    );
  }
  return value;
}

const API_ORIGIN = readApiOrigin();
const TURNSTILE_SITE_KEY = readTurnstileSiteKey();

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Metadata is resolved before the page streams, for every client. By default Next streams it for
  // browsers, and on a router.refresh() (a claim ends in one) an async generateMetadata, as /s
  // has, arrived as a late chunk: the old <title> went ~300 ms before the new one came, so the
  // page was untitled to screen readers and to axe. Every page here renders per request and waits
  // for its own data anyway, so streaming metadata buys nothing.
  htmlLimitedBots: /.*/,
  reactStrictMode: true,
  // Inlined at build: server code calls exactly the API the rewrite points at, and the browser
  // gets the Turnstile site key.
  // Sentry's web DSN and release, inlined at build. Only deploy.yml sets SENTRY_DSN_WEB, so
  // previews, CI and local builds carry none and report nothing (spec §10, D50).
  env: {
    API_ORIGIN,
    TURNSTILE_SITE_KEY,
    SENTRY_DSN_WEB: process.env.SENTRY_DSN_WEB ?? '',
    SENTRY_RELEASE: process.env.GITHUB_SHA ?? 'dev',
  },
  // Maps for the server bundles, so the web server reports TypeScript lines at runtime (D52).
  experimental: { serverSourceMaps: true },
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
      // Token pages (spec §6.7): no Referer can carry the token, and search engines skip them.
      ...['/verify-email', '/reset-password/confirm', '/s/:shareToken', '/c/:manageToken'].map(
        (source) => ({
          source,
          headers: [
            { key: 'Referrer-Policy', value: 'no-referrer' },
            { key: 'X-Robots-Tag', value: 'noindex' },
          ],
        }),
      ),
    ];
  },
};

export default nextConfig;
