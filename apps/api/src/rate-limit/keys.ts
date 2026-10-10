import { createHash } from 'node:crypto';

/**
 * A rate-limit key: a scope plus a SHA-256 prefix of the identifying value (an email or an IP), so
 * the counters table never holds raw personal data.
 */
export function rateLimitKey(scope: string, value: string): string {
  return `${scope}:${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
}
