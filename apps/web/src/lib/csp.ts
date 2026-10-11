const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

/**
 * The Content-Security-Policy for one page request (spec §6.9, amended 2026-10-10). Every page
 * allows Cloudflare's Turnstile challenge: a CSP belongs to the document, and client-side
 * navigation keeps the first page's policy, so a per-page allowance broke the widget after an
 * in-app link onto an auth page. With 'strict-dynamic', CSP3 browsers ignore the script-src host;
 * the effective widening is frame-src to that one origin.
 */
export function contentSecurityPolicy({ nonce, dev }: { nonce: string; dev: boolean }): string {
  const scripts = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    TURNSTILE_ORIGIN,
    ...(dev ? ["'unsafe-eval'"] : []),
  ];
  return [
    "default-src 'self'",
    `script-src ${scripts.join(' ')}`,
    // React and next/font set style attributes, which a nonce can't cover.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data:",
    "font-src 'self'",
    "connect-src 'self'",
    `frame-src ${TURNSTILE_ORIGIN}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}
