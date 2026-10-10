import { describe, expect, it } from 'vitest';
import { rateLimitKey } from './keys.js';

describe('rateLimitKey', () => {
  it('scopes a hashed value, so counters never store a raw email or IP', () => {
    const key = rateLimitKey('login:email', 'ada@example.com');
    expect(key).toMatch(/^login:email:[0-9a-f]{32}$/);
    expect(key).not.toContain('ada');
  });

  it('is stable for one value, and differs between values and between scopes', () => {
    expect(rateLimitKey('login:ip', '203.0.113.7')).toBe(rateLimitKey('login:ip', '203.0.113.7'));
    expect(rateLimitKey('login:ip', '203.0.113.7')).not.toBe(
      rateLimitKey('login:ip', '203.0.113.8'),
    );
    expect(rateLimitKey('login:ip', '203.0.113.7')).not.toBe(
      rateLimitKey('mail:ip', '203.0.113.7'),
    );
  });
});
