const SIGNED_IN_ONLY = ['/list', '/settings'];

/**
 * Where the proxy sends a request instead, judged only by whether the session cookie exists
 * (spec §6.1). The API makes every real decision, and the pages send a stale cookie to /login.
 * /login itself is never redirected: a stale cookie would loop (rule 8).
 */
export function authRedirect(url: URL, hasSessionCookie: boolean): string | null {
  const path = url.pathname;
  const signedInOnly = SIGNED_IN_ONLY.some((p) => path === p || path.startsWith(`${p}/`));
  if (signedInOnly && !hasSessionCookie) {
    return `/login?next=${encodeURIComponent(path + url.search)}`;
  }
  if (path === '/' && hasSessionCookie) return '/list';
  return null;
}
