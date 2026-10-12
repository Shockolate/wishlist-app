import { describe, expect, it } from 'vitest';
import { isPublicAddress, PUBLIC_WEB } from './address-policy.js';

describe('isPublicAddress (spec §6.8: an allowlist)', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['10.0.0.1', 'private'],
    ['172.16.0.1', 'private'],
    ['192.168.1.1', 'private'],
    ['100.64.0.1', 'CGNAT'],
    ['169.254.169.254', 'link-local: the cloud metadata service'],
    ['0.0.0.0', 'unspecified'],
    ['255.255.255.255', 'broadcast'],
    ['224.0.0.1', 'multicast'],
    ['192.0.2.1', 'documentation (reserved)'],
    ['198.18.0.1', 'benchmarking'],
    ['::', 'unspecified'],
    ['::1', 'loopback'],
    ['fe80::1', 'link-local'],
    ['fc00::1', 'unique-local'],
    ['fd12:3456::1', 'unique-local'],
    ['ff02::1', 'multicast'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ['::ffff:10.0.0.1', 'IPv4-mapped private'],
    ['::ffff:0:7f00:1', 'IPv4-translated (RFC 6145)'],
    ['64:ff9b::7f00:1', 'NAT64 (RFC 6052)'],
    ['2002:7f00:1::', '6to4'],
    ['2001::1', 'Teredo'],
    ['2001:db8::1', 'documentation'],
    ['not an address', 'garbage'],
  ])('refuses %s (%s)', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(['93.184.216.34', '8.8.8.8', '2606:4700::1111', '::ffff:8.8.8.8'])(
    'allows the public address %s',
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );
});

describe('PUBLIC_WEB', () => {
  it('allows public addresses on ports 80 and 443 only', () => {
    expect(PUBLIC_WEB.allows('93.184.216.34', 443)).toBe(true);
    expect(PUBLIC_WEB.allows('93.184.216.34', 80)).toBe(true);
    expect(PUBLIC_WEB.allows('93.184.216.34', 8080)).toBe(false);
    expect(PUBLIC_WEB.allows('127.0.0.1', 443)).toBe(false);
  });
});
