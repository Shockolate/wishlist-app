import type { UnfurlResponse } from '@wishlist/contracts';
import type { Clock } from '../core/clock.js';
import type { EmailMessage, EmailSender } from '../email/email-sender.js';
import type { ErrorContext, ErrorReporter } from '../observability/error-reporter.js';
import type { BreachedPasswordChecker } from '../security/breached-passwords.js';
import type { CaptchaVerdict, CaptchaVerifier } from '../security/captcha.js';
import type { AmazonLookup } from '../unfurl/amazon-lookup.js';
import type { EtsyLookup } from '../unfurl/etsy-lookup.js';
import type { LookupResult } from '../unfurl/lookup-result.js';
import type { MetadataFetcher } from '../unfurl/metadata-fetcher.js';

/** A clock tests move by hand. */
export class FakeClock implements Clock {
  private current: Date;

  constructor(start: Date) {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(time: Date): void {
    this.current = new Date(time);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** Turnstile stand-in. Set `verdict`; `tokens` records what was checked. */
export class FakeCaptcha implements CaptchaVerifier {
  verdict: CaptchaVerdict = 'passed';
  readonly tokens: string[] = [];

  verify(token: string): Promise<CaptchaVerdict> {
    this.tokens.push(token);
    return Promise.resolve(this.verdict);
  }
}

/** HIBP stand-in. Add passwords to `breached`; `checked` records every password looked up. */
export class FakeBreachedPasswords implements BreachedPasswordChecker {
  readonly breached = new Set<string>();
  readonly checked: string[] = [];

  isBreached(password: string): Promise<boolean> {
    this.checked.push(password);
    return Promise.resolve(this.breached.has(password));
  }
}

/**
 * Records every message the moment `send` is called, before the promise settles. So a test sees
 * a queued email as soon as the HTTP response arrives. Set `failNext` to make the next delivery
 * fail.
 */
export class FakeEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  failNext = false;

  send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('email provider is down'));
    }
    return Promise.resolve();
  }
}

/** Unfurl stand-in. Set `next`; `urls` records every URL asked for. */
export class FakeMetadataFetcher implements MetadataFetcher {
  next: UnfurlResponse = { failureReason: 'NO_METADATA' };
  readonly urls: string[] = [];

  fetch(url: string): Promise<UnfurlResponse> {
    this.urls.push(url);
    return Promise.resolve(this.next);
  }
}

/** Amazon lookup stand-in: answers `next`, records the ASINs it was asked for. */
export class FakeAmazonLookup implements AmazonLookup {
  next: LookupResult = { ok: false, reason: 'NO_METADATA' };
  readonly asins: string[] = [];

  lookUp(asin: string): Promise<LookupResult> {
    this.asins.push(asin);
    return Promise.resolve(this.next);
  }
}

/** Etsy lookup stand-in: answers `next`, records the listing IDs it was asked for. */
export class FakeEtsyLookup implements EtsyLookup {
  next: LookupResult = { ok: false, reason: 'NO_METADATA' };
  readonly listingIds: string[] = [];

  lookUp(listingId: string): Promise<LookupResult> {
    this.listingIds.push(listingId);
    return Promise.resolve(this.next);
  }
}

/** Error-reporting stand-in. Records every report. */
export class FakeErrorReporter implements ErrorReporter {
  readonly exceptions: { error: unknown; context?: ErrorContext }[] = [];
  readonly warnings: { message: string; context?: ErrorContext }[] = [];

  captureException(error: unknown, context?: ErrorContext): void {
    this.exceptions.push({ error, context });
  }

  captureWarning(message: string, context?: ErrorContext): void {
    this.warnings.push({ message, context });
  }
}
