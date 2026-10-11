import { NextResponse, type NextRequest } from 'next/server';
import { authRedirect } from '@/lib/auth-routing';
import { contentSecurityPolicy, usesTurnstile } from '@/lib/csp';
import { SESSION_COOKIE } from '@/lib/session';

/**
 * Runs before every page. It sends signed-out visitors away from account pages (spec §6.1), then
 * gives the page a fresh CSP nonce. Next.js reads the nonce from the request's CSP header and
 * applies it to its own scripts (spec §6.9).
 */
export function proxy(request: NextRequest) {
  const redirect = authRedirect(request.nextUrl, request.cookies.has(SESSION_COOKIE));
  if (redirect) return NextResponse.redirect(new URL(redirect, request.url));

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = contentSecurityPolicy({
    nonce,
    turnstile: usesTurnstile(request.nextUrl.pathname),
    dev: process.env.NODE_ENV === 'development',
  });
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('content-security-policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: not the /api rewrite, static files, or robots.txt.
      source: '/((?!api|_next/static|_next/image|favicon.ico|robots.txt).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
