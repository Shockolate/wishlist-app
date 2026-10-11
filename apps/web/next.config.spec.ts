import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadConfig(apiOrigin: string, siteKey = '1x00000000000000000000AA') {
  vi.stubEnv('API_ORIGIN', apiOrigin);
  vi.stubEnv('TURNSTILE_SITE_KEY', siteKey);
  vi.resetModules();
  return (await import('./next.config')).default;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('next.config', () => {
  it('refuses to load without API_ORIGIN', async () => {
    await expect(loadConfig('')).rejects.toThrow(/API_ORIGIN must be set/);
  });

  it('refuses an API_ORIGIN with a path or trailing slash', async () => {
    await expect(loadConfig('https://api.example.test/')).rejects.toThrow(/bare origin/);
    await expect(loadConfig('https://api.example.test/api')).rejects.toThrow(/bare origin/);
  });

  it('rewrites /api/* to the same path on the API origin', async () => {
    const config = await loadConfig('https://api.example.test');
    await expect(config.rewrites?.()).resolves.toEqual([
      { source: '/api/:path*', destination: 'https://api.example.test/api/:path*' },
    ]);
  });

  it('inlines API_ORIGIN and the Turnstile site key at build', async () => {
    const config = await loadConfig('https://api.example.test');
    expect(config.env).toEqual({
      API_ORIGIN: 'https://api.example.test',
      TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
    });
  });

  it('refuses to load without TURNSTILE_SITE_KEY (rule 11)', async () => {
    await expect(loadConfig('https://api.example.test', '')).rejects.toThrow(
      /TURNSTILE_SITE_KEY must be set/,
    );
  });

  it('keeps tokens out of Referer and search on the token pages (spec §6.7, rule 7)', async () => {
    const rules = (await (await loadConfig('https://api.example.test')).headers?.()) ?? [];
    for (const source of ['/verify-email', '/reset-password/confirm']) {
      expect(rules.find((rule) => rule.source === source)?.headers).toEqual([
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Robots-Tag', value: 'noindex' },
      ]);
    }
  });
});
