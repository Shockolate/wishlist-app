/**
 * Redaction for anything that leaves the app for a third party, today Sentry (spec §6.7, D50).
 * The token and email patterns are built from the ones the app validates with (patterns.ts).
 */
import { CAPABILITY_TOKEN_PATTERN, EMAIL_PATTERN, EMAIL_TOKEN_PATTERN } from './patterns.js';

const REDACTED = '[redacted]';

/** The body of a /^…$/ validation pattern, to find what it accepts inside longer text. */
function unanchored(pattern: RegExp): string {
  const { source } = pattern;
  if (!source.startsWith('^') || !source.endsWith('$')) {
    throw new Error(`expected an anchored pattern, got /${source}/`);
  }
  return `(?:${source.slice(1, -1)})`;
}

/** A share or manage token where the app's URLs carry one: /s/, /c/, /shared/, /claims/. */
const PATH_TOKEN = new RegExp(
  `(\\/(?:s|c|shared|claims)\\/)${unanchored(CAPABILITY_TOKEN_PATTERN)}(?![A-Za-z0-9_-])`,
  'g',
);
/** The verify and reset pages' ?token=… */
const QUERY_TOKEN = /([?&]token=)[^&#\s"'<>]+/gi;
/** An email token wherever it appears. */
const EMAIL_TOKEN = new RegExp(
  `(?<![A-Za-z0-9_-])${unanchored(EMAIL_TOKEN_PATTERN)}(?![A-Za-z0-9_-])`,
  'g',
);
/**
 * An email address, as z.email() (EmailSchema) accepts one. Its domain ends in letters, so pnpm's
 * `@sentry+node@11.8.0/…` paths in stack traces are left alone. There's no boundary before it: a
 * run that isn't a valid address as a whole still gets its valid tail redacted.
 */
const EMAIL = new RegExp(unanchored(EMAIL_PATTERN), 'g');

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
