const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';
const TURNSTILE_PATHS = ['/signup', '/verify-email', '/reset-password'];

/** Pages that render the Turnstile widget, and so may load Cloudflare's script and frame (rule 6). */
export function usesTurnstile(pathname: string): boolean {
  return TURNSTILE_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/** The Content-Security-Policy for one page request (spec §6.9 as amended by rule 4). */
export function contentSecurityPolicy({
  nonce,
  turnstile,
  dev,
}: {
  nonce: string;
  turnstile: boolean;
  dev: boolean;
}): string {
  const scripts = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(turnstile ? [TURNSTILE_ORIGIN] : []),
    ...(dev ? ["'unsafe-eval'"] : []),
  ];
  return [
    "default-src 'self'",
    `script-src ${scripts.join(' ')}`,
    // React and next/font set style attributes, which a nonce can't cover (rule 4).
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data:",
    "font-src 'self'",
    "connect-src 'self'",
    ...(turnstile ? [`frame-src ${TURNSTILE_ORIGIN}`] : []),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}
