/**
 * Redaction for anything that leaves the app for a third party, today Sentry (spec §6.7, D50).
 * The token shapes match CAPABILITY_TOKEN_PATTERN (claims.ts) and EmailTokenSchema (auth.ts).
 */

const REDACTED = '[redacted]';

/** A share or manage token where the app's URLs carry one: /s/, /c/, /shared/, /claims/. */
const PATH_TOKEN = /(\/(?:s|c|shared|claims)\/)[A-Za-z0-9_-]{22}(?![A-Za-z0-9_-])/g;
/** The verify and reset pages' ?token=… */
const QUERY_TOKEN = /([?&]token=)[^&#\s"'<>]+/gi;
/** An email token (32 random bytes, base64url) wherever it appears. */
const EMAIL_TOKEN = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g;
/**
 * An email address. The domain must end in letters, so pnpm's `@sentry+node@11.8.0/…` paths in
 * stack traces are left alone.
 */
const EMAIL =
  /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![A-Za-z0-9-])/g;

export function redactTokens(text: string): string {
  return text
    .replace(PATH_TOKEN, `$1${REDACTED}`)
    .replace(QUERY_TOKEN, `$1${REDACTED}`)
    .replace(EMAIL_TOKEN, REDACTED)
    .replace(EMAIL, '[email]');
}

/** A copy of `value` with every string, and every object key, passed through redactTokens. */
export function redactDeep<T>(value: T): T {
  return walk(value, new WeakMap()) as T;
}

function walk(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (typeof value === 'string') return redactTokens(value);
  if (value === null || typeof value !== 'object') return value;
  const known = seen.get(value);
  if (known !== undefined) return known;
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(walk(item, seen));
    return copy;
  }
  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  for (const [key, item] of Object.entries(value)) copy[redactTokens(key)] = walk(item, seen);
  return copy;
}
