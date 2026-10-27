import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadConfig(apiOrigin: string, siteKey = '1x00000000000000000000AA') {
  vi.stubEnv('API_ORIGIN', apiOrigin);
  vi.stubEnv('TURNSTILE_SITE_KEY', siteKey);
  vi.stubEnv('SENTRY_DSN_WEB', undefined);
  vi.stubEnv('GITHUB_SHA', undefined);
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

  it('inlines API_ORIGIN and the Turnstile site key at build, and no Sentry DSN by default (D50)', async () => {
    const config = await loadConfig('https://api.example.test');
    expect(config.env).toEqual({
      API_ORIGIN: 'https://api.example.test',
      TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
      SENTRY_DSN_WEB: '',
      SENTRY_RELEASE: 'dev',
    });
  });

  it('inlines the Sentry web DSN and the release (the commit) when the build sets them', async () => {
    vi.stubEnv('API_ORIGIN', 'https://api.example.test');
    vi.stubEnv('TURNSTILE_SITE_KEY', '1x00000000000000000000AA');
    vi.stubEnv('SENTRY_DSN_WEB', 'https://k@o1.ingest.us.sentry.io/1');
    vi.stubEnv('GITHUB_SHA', 'abc123');
    vi.resetModules();
    const config = (await import('./next.config')).default;
    expect(config.env).toMatchObject({
      SENTRY_DSN_WEB: 'https://k@o1.ingest.us.sentry.io/1',
      SENTRY_RELEASE: 'abc123',
    });
  });

  it('emits source maps for the server bundles (D52)', async () => {
    const config = await loadConfig('https://api.example.test');
    expect(config.experimental?.serverSourceMaps).toBe(true);
  });

  it('emits browser source maps only for a build that reports to Sentry (D52)', async () => {
    expect((await loadConfig('https://api.example.test')).productionBrowserSourceMaps).toBe(false);
    vi.stubEnv('API_ORIGIN', 'https://api.example.test');
    vi.stubEnv('TURNSTILE_SITE_KEY', '1x00000000000000000000AA');
    vi.stubEnv('SENTRY_DSN_WEB', 'https://k@o1.ingest.us.sentry.io/1');
    vi.resetModules();
    const config = (await import('./next.config')).default;
    expect(config.productionBrowserSourceMaps).toBe(true);
  });

  it('ships the share preview’s fonts and gift tag with its route, which reads them from disk (Plan 12)', async () => {
    const config = await loadConfig('https://api.example.test');
    expect(config.outputFileTracingIncludes).toEqual({
      '/s/[shareToken]/preview.jpg': ['./assets/fonts/*.ttf', './src/app/icon.svg'],
    });
  });

  it('refuses to load without TURNSTILE_SITE_KEY (Plan 2b rule 11)', async () => {
    await expect(loadConfig('https://api.example.test', '')).rejects.toThrow(
      /TURNSTILE_SITE_KEY must be set/,
    );
  });

  it('keeps tokens out of Referer and search on the token pages, and Your gifts out of both (spec §6.7, D76)', async () => {
    const rules = (await (await loadConfig('https://api.example.test')).headers?.()) ?? [];
    for (const source of [
      '/verify-email',
      '/reset-password/confirm',
      '/s/:shareToken',
      '/c/:manageToken',
      '/gifts',
    ]) {
      expect(rules.find((rule) => rule.source === source)?.headers).toEqual([
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Robots-Tag', value: 'noindex' },
      ]);
    }
  });

  it('gives the share preview image the share page’s headers, since its URL carries the token (Plan 12, design §5.3)', async () => {
    const rules = (await (await loadConfig('https://api.example.test')).headers?.()) ?? [];
    expect(rules.find((rule) => rule.source === '/s/:shareToken/preview.jpg')?.headers).toEqual([
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Robots-Tag', value: 'noindex' },
    ]);
  });

  it('turns off the browser features Hanker never uses, but not clipboard or share (Plan 6)', async () => {
    const rules = (await (await loadConfig('https://api.example.test')).headers?.()) ?? [];
    const rule = rules.find((r) => r.source === '/:path*');
    expect(rule?.headers).toContainEqual({
      key: 'Permissions-Policy',
      value:
        'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), midi=(), display-capture=(), accelerometer=(), gyroscope=(), magnetometer=(), browsing-topics=()',
    });
    const value = rule?.headers.find((h) => h.key === 'Permissions-Policy')?.value ?? '';
    for (const kept of ['clipboard-write', 'clipboard-read', 'web-share']) {
      expect(value).not.toContain(kept);
    }
  });
});
