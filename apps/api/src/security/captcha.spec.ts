import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  // Swallows the warnings the unavailable paths log, and lets the logging tests assert on them.
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
  });

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

  it.each(['missing-input-secret', 'invalid-input-secret', 'bad-request', 'internal-error'])(
    'is unavailable, and says why, when Cloudflare reports %s: the fault is ours, not the visitor’s',
    async (code) => {
      const { fn } = fakeFetch(() => json({ success: false, 'error-codes': [code] }));
      expect(await new TurnstileVerifier('secret', fn).verify('token', '203.0.113.7')).toBe(
        'unavailable',
      );
      expect(warn).toHaveBeenCalledWith(`captcha unavailable: Cloudflare reported ${code}`);
    },
  );

  it.each(['invalid-input-response', 'timeout-or-duplicate', 'missing-input-response'])(
    'fails the visitor when Cloudflare reports %s',
    async (code) => {
      const { fn } = fakeFetch(() => json({ success: false, 'error-codes': [code] }));
      expect(await new TurnstileVerifier('secret', fn).verify('token', '203.0.113.7')).toBe(
        'failed',
      );
    },
  );

  describe('logging', () => {
    const loggedText = () => warn.mock.calls.flat().map(String).join('\n');

    it.each([
      ['an HTTP error', () => json({}, 500)],
      ['an internal error', () => json({ success: false, 'error-codes': ['internal-error'] })],
      ['a body that is not siteverify JSON', () => new Response('<html>', { status: 200 })],
    ])('warns on %s without leaking the secret or the token', async (_label, respond) => {
      const { fn } = fakeFetch(respond);
      await new TurnstileVerifier('s3cret-key', fn).verify('t0ken-value', '203.0.113.7');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(loggedText()).not.toContain('s3cret-key');
      expect(loggedText()).not.toContain('t0ken-value');
    });

    it('warns when Cloudflare is unreachable, without leaking the secret or the token', async () => {
      const fn = (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch;
      await new TurnstileVerifier('s3cret-key', fn).verify('t0ken-value', '203.0.113.7');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(loggedText()).toContain('fetch failed');
      expect(loggedText()).not.toContain('s3cret-key');
      expect(loggedText()).not.toContain('t0ken-value');
    });

    it('stays silent without a secret, which is the intended dark state', async () => {
      const { fn } = fakeFetch(() => json({ success: true }));
      await new TurnstileVerifier(undefined, fn).verify('token', '203.0.113.7');
      expect(warn).not.toHaveBeenCalled();
    });

    it('stays silent when the token is simply rejected', async () => {
      const { fn } = fakeFetch(() =>
        json({ success: false, 'error-codes': ['invalid-input-response'] }),
      );
      await new TurnstileVerifier('secret', fn).verify('token', '203.0.113.7');
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
