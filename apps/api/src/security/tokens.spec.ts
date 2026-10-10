import { describe, expect, it } from 'vitest';
import { hashToken, newToken } from './tokens.js';

describe('newToken', () => {
  it('encodes 32 random bytes as 43 base64url characters, and 16 as 22', () => {
    expect(newToken(32)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken(16)).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('never repeats', () => {
    expect(new Set(Array.from({ length: 100 }, () => newToken(32))).size).toBe(100);
  });
});

describe('hashToken', () => {
  it('stores a token as its SHA-256 in hex (spec §4)', () => {
    const token = newToken(32);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
  });
});
