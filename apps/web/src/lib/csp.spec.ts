import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, usesTurnstile } from './csp';

describe('contentSecurityPolicy (spec §6.9, rule 4)', () => {
  it('locks a page to its own origin and this request’s nonce', () => {
    expect(contentSecurityPolicy({ nonce: 'abc', turnstile: false, dev: false })).toBe(
      "default-src 'self'; script-src 'self' 'nonce-abc' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    );
  });

  it('lets a Turnstile page load the challenge script and its frame', () => {
    const csp = contentSecurityPolicy({ nonce: 'abc', turnstile: true, dev: false });
    expect(csp).toContain(
      "script-src 'self' 'nonce-abc' 'strict-dynamic' https://challenges.cloudflare.com;",
    );
    expect(csp).toContain('; frame-src https://challenges.cloudflare.com;');
  });

  it("adds 'unsafe-eval' in development only, for React's dev overlays", () => {
    expect(contentSecurityPolicy({ nonce: 'abc', turnstile: false, dev: true })).toContain(
      "'strict-dynamic' 'unsafe-eval';",
    );
  });
});

describe('usesTurnstile (rule 6)', () => {
  it.each([
    ['/signup', true],
    ['/verify-email', true],
    ['/reset-password', true],
    ['/reset-password/confirm', true],
    ['/login', false],
    ['/', false],
    ['/settings', false],
    ['/signups', false],
  ])('%s → %s', (path, expected) => {
    expect(usesTurnstile(path)).toBe(expected);
  });
});
