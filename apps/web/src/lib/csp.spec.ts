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
