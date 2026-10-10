import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { clientIp } from './client-ip.js';

function request(headers: Record<string, string>, remoteAddress = '10.0.0.1'): Request {
  return { headers, socket: { remoteAddress } } as unknown as Request;
}

describe('clientIp (spec §6.6)', () => {
  it('uses x-real-ip on Vercel, whose edge overwrites anything the client sent', () => {
    expect(clientIp(request({ 'x-real-ip': '203.0.113.7' }), true)).toBe('203.0.113.7');
  });

  it('ignores x-real-ip anywhere else, because a client could set it', () => {
    expect(clientIp(request({ 'x-real-ip': '203.0.113.7' }), false)).toBe('10.0.0.1');
  });

  it('falls back to the socket address when the header is not a single IP', () => {
    expect(clientIp(request({ 'x-real-ip': '203.0.113.7, 10.0.0.9' }), true)).toBe('10.0.0.1');
  });
});
