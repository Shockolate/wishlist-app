import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from './csp';

describe('contentSecurityPolicy (spec §6.9, Plan 2b rule 4)', () => {
  it('locks a page to its own origin and this request’s nonce, and allows Cloudflare’s challenge', () => {
    expect(contentSecurityPolicy({ nonce: 'abc', dev: false })).toBe(
      "default-src 'self'; script-src 'self' 'nonce-abc' 'strict-dynamic' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self'; connect-src 'self'; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    );
  });

  it("adds 'unsafe-eval' in development only, for React's dev overlays", () => {
    expect(contentSecurityPolicy({ nonce: 'abc', dev: true })).toContain(
      "'strict-dynamic' https://challenges.cloudflare.com 'unsafe-eval';",
    );
  });
});

const connectSrc = (csp: string) => csp.split('; ').find((d) => d.startsWith('connect-src '));

describe('contentSecurityPolicy connect-src (spec §6.9, D51)', () => {
  it('is only self without a Sentry origin', () => {
    expect(connectSrc(contentSecurityPolicy({ nonce: 'n', dev: false }))).toBe(
      "connect-src 'self'",
    );
  });

  it('adds exactly the Sentry ingest origin when there is one', () => {
    expect(
      connectSrc(
        contentSecurityPolicy({
          nonce: 'n',
          dev: false,
          sentryOrigin: 'https://o456.ingest.us.sentry.io',
        }),
      ),
    ).toBe("connect-src 'self' https://o456.ingest.us.sentry.io");
  });
});
