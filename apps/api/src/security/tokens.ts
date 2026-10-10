import { createHash, randomBytes } from 'node:crypto';

/** A random base64url token: 32 bytes (sessions, email links) or 16 (share and claim links). */
export function newToken(bytes: 16 | 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * How every high-entropy token is stored: SHA-256, hex (spec §4). That's enough for random
 * tokens. Argon2 is only needed for passwords people choose.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
