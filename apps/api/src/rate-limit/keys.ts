import { isIP } from 'node:net';
import { createHash } from 'node:crypto';

/**
 * A rate-limit key: a scope plus a SHA-256 prefix of the identifying value (an email or an IP), so
 * the counters table never holds raw personal data.
 */
export function rateLimitKey(scope: string, value: string): string {
  return `${scope}:${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
}

/**
 * The part of an IP address that identifies one client for a per-IP limit (rule 13). An IPv6 host
 * usually holds a whole /64, so IPv6 is keyed by its first 64 bits. An IPv4-mapped IPv6 address is
 * keyed as the IPv4 address it carries.
 */
export function ipIdentity(ip: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped?.[1]) return mapped[1];
  const bare = ip.split('%')[0] ?? ip;
  if (isIP(bare) !== 6) return ip;
  return `${expandIpv6(bare).slice(0, 4).join(':')}::/64`;
}

/** A rate-limit key for a per-IP limit: the scope plus the hashed ipIdentity. */
export function ipRateLimitKey(scope: string, ip: string): string {
  return rateLimitKey(scope, ipIdentity(ip));
}

/** The eight groups of a valid IPv6 address, lowercase, without leading zeros. */
function expandIpv6(ip: string): string[] {
  const [head = '', tail] = ip.split('::');
  const groups = (part: string) => (part === '' ? [] : part.split(':').flatMap(dottedToGroups));
  const left = groups(head);
  const right = tail === undefined ? [] : groups(tail);
  const zeros = Array.from({ length: 8 - left.length - right.length }, () => '0');
  return [...left, ...zeros, ...right].map((group) => parseInt(group, 16).toString(16));
}

/** A dotted IPv4 tail (`64:ff9b::203.0.113.7`) is two groups. */
function dottedToGroups(group: string): string[] {
  if (!group.includes('.')) return [group];
  const [a = 0, b = 0, c = 0, d = 0] = group.split('.').map(Number);
  return [((a << 8) | b).toString(16), ((c << 8) | d).toString(16)];
}
