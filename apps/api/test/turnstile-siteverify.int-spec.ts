import { describe, expect, it } from 'vitest';
import { TurnstileVerifier } from '../src/security/captcha.js';

// Cloudflare's published test secret that fails every token (public, not a credential).
const ALWAYS_FAIL_TEST_SECRET = '2x0000000000000000000000000000000AA';

// E2E and previews use the always-pass test secret, which the verifier answers without asking
// Cloudflare. This is the one check before production that siteverify still accepts our request.
describe('TurnstileVerifier against Cloudflare’s siteverify', () => {
  // Retried so one network blip doesn't fail the run; a changed contract fails every attempt.
  it('gets a verdict for its request, not an error', { retry: 2 }, async () => {
    // `failed` needs a 200 with a body we parse and an error that blames the token. A malformed
    // request is `bad-request` (unavailable), as is an unreachable or reshaped siteverify.
    expect(
      await new TurnstileVerifier(ALWAYS_FAIL_TEST_SECRET).verify(
        'XXXX.DUMMY.TOKEN.XXXX',
        '203.0.113.7',
      ),
    ).toBe('failed');
  });
});
