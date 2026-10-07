import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadConfig(apiOrigin: string) {
  vi.stubEnv('API_ORIGIN', apiOrigin);
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

  it('inlines API_ORIGIN for server code', async () => {
    const config = await loadConfig('https://api.example.test');
    expect(config.env).toEqual({ API_ORIGIN: 'https://api.example.test' });
  });
});
