import { describe, expect, it } from 'vitest';
import { TurnstileVerifier } from './captcha.js';

function fakeFetch(respond: () => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(respond());
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('TurnstileVerifier', () => {
  it('passes when Cloudflare accepts the token', async () => {
    const { fn } = fakeFetch(() => json({ success: true }));
    expect(await new TurnstileVerifier('secret', fn).verify('token', '203.0.113.7')).toBe('passed');
  });

  it('sends the secret, the token and the client IP to siteverify', async () => {
    const { fn, calls } = fakeFetch(() => json({ success: true }));
    await new TurnstileVerifier('secret', fn).verify('token', '203.0.113.7');
    expect(calls[0]?.url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      secret: 'secret',
      response: 'token',
      remoteip: '203.0.113.7',
    });
  });

  it('leaves out an IP it could not determine', async () => {
    const { fn, calls } = fakeFetch(() => json({ success: true }));
    await new TurnstileVerifier('secret', fn).verify('token', 'unknown');
    expect(JSON.parse(calls[0]?.init.body as string)).not.toHaveProperty('remoteip');
  });

  it('fails when Cloudflare rejects the token', async () => {
    const { fn } = fakeFetch(() =>
      json({ success: false, 'error-codes': ['invalid-input-response'] }),
    );
    expect(await new TurnstileVerifier('secret', fn).verify('token', '203.0.113.7')).toBe('failed');
  });

  it('is unavailable without a secret, and then never calls Cloudflare', async () => {
    const { fn, calls } = fakeFetch(() => json({ success: true }));
    expect(await new TurnstileVerifier(undefined, fn).verify('token', '203.0.113.7')).toBe(
      'unavailable',
    );
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['an HTTP error', () => json({}, 500)],
    ['an internal error', () => json({ success: false, 'error-codes': ['internal-error'] })],
    ['a body that is not siteverify JSON', () => new Response('<html>', { status: 200 })],
  ])('is unavailable on %s', async (_label, respond) => {
    const { fn } = fakeFetch(respond);
    expect(await new TurnstileVerifier('secret', fn).verify('token', '203.0.113.7')).toBe(
      'unavailable',
    );
  });

  it('is unavailable when Cloudflare is unreachable', async () => {
    const fn = (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch;
    expect(await new TurnstileVerifier('secret', fn).verify('token', '203.0.113.7')).toBe(
      'unavailable',
    );
  });
});
