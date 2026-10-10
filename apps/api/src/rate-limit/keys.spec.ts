import { describe, expect, it } from 'vitest';
import { ipIdentity, ipRateLimitKey, rateLimitKey } from './keys.js';

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

describe('ipIdentity (rule 13)', () => {
  it('keeps an IPv4 address whole', () => {
    expect(ipIdentity('203.0.113.7')).toBe('203.0.113.7');
  });

  it('keys an IPv4-mapped IPv6 address as its IPv4 address', () => {
    expect(ipIdentity('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(ipIdentity('::FFFF:203.0.113.7')).toBe('203.0.113.7');
  });

  it('keys IPv6 by its /64, however the address is written', () => {
    expect(ipIdentity('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(ipIdentity('2001:0db8:0001:0002:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:2::/64');
    expect(ipIdentity('2001:DB8:1:2::')).toBe('2001:db8:1:2::/64');
    expect(ipIdentity('::1')).toBe('0:0:0:0::/64');
    expect(ipIdentity('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(ipIdentity('64:ff9b::203.0.113.7')).toBe('64:ff9b:0:0::/64');
  });

  it('passes through a value the API could not resolve', () => {
    expect(ipIdentity('unknown')).toBe('unknown');
  });
});

describe('ipRateLimitKey', () => {
  it('gives one /64 one key, and a neighbouring /64 another', () => {
    expect(ipRateLimitKey('mail:ip', '2001:db8:1:2::1')).toBe(
      ipRateLimitKey('mail:ip', '2001:db8:1:2:ffff::9'),
    );
    expect(ipRateLimitKey('mail:ip', '2001:db8:1:2::1')).not.toBe(
      ipRateLimitKey('mail:ip', '2001:db8:1:3::1'),
    );
  });
});
