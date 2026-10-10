import { Inject, Injectable } from '@nestjs/common';
import { rateLimitKey } from '../rate-limit/keys.js';
import { RateLimiter } from '../rate-limit/rate-limiter.js';
import { CAPTCHA_VERIFIER, type CaptchaVerifier } from '../security/captcha.js';
import { captchaFailed, captchaUnavailable } from './auth-errors.js';
import { MAIL_PER_EMAIL, MAIL_PER_IP } from './rate-limits.js';

/**
 * The checks in front of every endpoint that emails an address the caller supplied: signup,
 * resend-verification and reset-request (spec §6.5, §6.6). The per-IP limit comes first, so
 * floods never reach Cloudflare. Turnstile comes before the per-address limit, so a bot can't use
 * up a victim's three emails an hour without solving a challenge.
 */
@Injectable()
export class EmailGate {
  constructor(
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(CAPTCHA_VERIFIER) private readonly captcha: CaptchaVerifier,
  ) {}

  async admit(email: string, turnstileToken: string, ip: string): Promise<void> {
    await this.limiter.enforce(rateLimitKey('mail:ip', ip), MAIL_PER_IP);
    const verdict = await this.captcha.verify(turnstileToken, ip);
    if (verdict === 'unavailable') throw captchaUnavailable();
    if (verdict === 'failed') throw captchaFailed();
    await this.limiter.enforce(rateLimitKey('mail:email', email), MAIL_PER_EMAIL);
  }
}
