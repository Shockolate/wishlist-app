import type { Response } from 'express';

/**
 * The `__Host-` prefix makes browsers insist on Secure, Path=/ and no Domain (spec §6.1). Browsers
 * treat http://localhost as secure, so the cookie works in local development and E2E too.
 */
export const SESSION_COOKIE = '__Host-session';
/** How long a session lives without use. The database's expires_at is the only authority (D27). */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Sliding expiry moves forward at most this often, so reads don't write on every request. */
export const SESSION_REFRESH_MS = 60 * 60 * 1000;
/**
 * The cookie outlives any session: 400 days, the longest browsers keep one. It's set at login and
 * never reissued, because a refresh can happen on a server-to-server call whose Set-Cookie never
 * reaches the browser (D27).
 */
export const SESSION_COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** The session token from a Cookie header, if it's there and well-formed. */
export function readSessionToken(cookieHeader: string | undefined): string | undefined {
  for (const pair of cookieHeader?.split(';') ?? []) {
    const [name, value] = pair.trim().split('=', 2);
    if (name === SESSION_COOKIE) {
      return value !== undefined && TOKEN_PATTERN.test(value) ? value : undefined;
    }
  }
  return undefined;
}

/** Whether a Cookie header carries the session cookie at all, well-formed or not. */
export function hasSessionCookie(cookieHeader: string | undefined): boolean {
  return (cookieHeader ?? '')
    .split(';')
    .some((pair) => pair.trim().startsWith(`${SESSION_COOKIE}=`));
}

const ATTRIBUTES = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const;

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, { ...ATTRIBUTES, maxAge: SESSION_COOKIE_MAX_AGE_MS });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, ATTRIBUTES);
}
