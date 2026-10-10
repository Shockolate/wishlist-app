import { isIP } from 'node:net';
import { Logger } from '@nestjs/common';
import { z } from 'zod';

export type CaptchaVerdict = 'passed' | 'failed' | 'unavailable';

/** Port for the human check on endpoints that send email (spec §6.5, §8). */
export interface CaptchaVerifier {
  verify(token: string, remoteIp: string): Promise<CaptchaVerdict>;
}

export const CAPTCHA_VERIFIER = Symbol('CAPTCHA_VERIFIER');

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const SiteverifySchema = z.object({
  success: z.boolean(),
  'error-codes': z.array(z.string()).default([]),
});

/**
 * Cloudflare Turnstile. Having no secret, a network failure, or an error on Cloudflare's side all
 * mean "unavailable". The endpoints then refuse rather than let requests through unchecked
 * (spec §9).
 */
export class TurnstileVerifier implements CaptchaVerifier {
  private readonly logger = new Logger('Turnstile');

  constructor(
    private readonly secret: string | undefined,
    private readonly fetchFn: typeof fetch = fetch,
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
    if (!res.ok) return this.unavailable(`siteverify answered HTTP ${res.status}`);
    const json: unknown = await res.json().catch(() => undefined);
    const body = SiteverifySchema.safeParse(json);
    if (!body.success) return this.unavailable('unexpected siteverify response');
    if (body.data.success) return 'passed';
    return body.data['error-codes'].includes('internal-error')
      ? this.unavailable('Cloudflare reported internal-error')
      : 'failed';
  }

  /**
   * Logs why, so an operator can tell an outage from a changed response shape or a bad secret.
   * Only fixed text, an HTTP status or the network error's message is logged, never the token
   * or the secret. The no-secret case doesn't come through here: that's the intended dark state.
   */
  private unavailable(reason: string): CaptchaVerdict {
    this.logger.warn(`captcha unavailable: ${reason}`);
    return 'unavailable';
  }
}
