import { isIP } from 'node:net';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { NOOP_REPORTER, type ErrorReporter } from '../observability/error-reporter.js';

export type CaptchaVerdict = 'passed' | 'failed' | 'unavailable';

/** Port for the human check on endpoints that send email (spec §6.5, §8). */
export interface CaptchaVerifier {
  verify(token: string, remoteIp: string): Promise<CaptchaVerdict>;
}

export const CAPTCHA_VERIFIER = Symbol('CAPTCHA_VERIFIER');

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Siteverify errors that mean our request is wrong, not the visitor's: an operator must act
 * (Plan 2b rule 16).
 */
const OPERATOR_ERRORS = new Set([
  'missing-input-secret',
  'invalid-input-secret',
  'bad-request',
  'internal-error',
]);

/** An error code as Cloudflare writes them. Anything else stays out of the log. */
const isPlainCode = (code: string) => /^[a-z-]{1,40}$/.test(code);

const SiteverifySchema = z.object({
  success: z.boolean(),
  'error-codes': z.array(z.string()).default([]),
});

/**
 * Cloudflare Turnstile. Having no secret, a network failure, an unexpected response, or a
 * siteverify error that blames our own request (OPERATOR_ERRORS) all mean "unavailable". The
 * endpoints then refuse rather than let requests through unchecked (spec §9).
 */
export class TurnstileVerifier implements CaptchaVerifier {
  private readonly logger = new Logger('Turnstile');

  constructor(
    private readonly secret: string | undefined,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly reporter: ErrorReporter = NOOP_REPORTER,
  ) {}

  async verify(token: string, remoteIp: string): Promise<CaptchaVerdict> {
    if (!this.secret) return 'unavailable';
    let res: Response;
    try {
      res = await this.fetchFn(SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          secret: this.secret,
          response: token,
          ...(isIP(remoteIp) ? { remoteip: remoteIp } : {}),
        }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      return this.unavailable(error instanceof Error ? error.message : String(error));
    }
    const json: unknown = await res.json().catch(() => undefined);
    const body = SiteverifySchema.safeParse(json);
    if (!res.ok) {
      // Cloudflare answers a bad or missing secret with HTTP 400 and says which in the body.
      const codes = body.success ? body.data['error-codes'].filter(isPlainCode) : [];
      const detail = codes.length > 0 ? ` (${codes.join(', ')})` : '';
      return this.unavailable(`siteverify answered HTTP ${res.status}${detail}`);
    }
    if (!body.success) return this.unavailable('unexpected siteverify response');
    if (body.data.success) return 'passed';
    const operatorError = body.data['error-codes'].find((code) => OPERATOR_ERRORS.has(code));
    return operatorError ? this.unavailable(`Cloudflare reported ${operatorError}`) : 'failed';
  }

  /**
   * Logs why, so an operator can tell an outage from a changed response shape or a bad secret.
   * Only fixed text, an HTTP status, Cloudflare's error codes or the network error's message is
   * logged, never the token or the secret. The no-secret case doesn't come through here: that's
   * the intended dark state.
   */
  private unavailable(reason: string): CaptchaVerdict {
    this.logger.warn(`captcha unavailable: ${reason}`);
    this.reporter.captureWarning(`captcha unavailable: ${reason}`);
    return 'unavailable';
  }
}
