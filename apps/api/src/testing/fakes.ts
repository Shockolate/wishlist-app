import type { EmailMessage, EmailSender } from '../email/email-sender.js';
import type { BreachedPasswordChecker } from '../security/breached-passwords.js';
import type { CaptchaVerdict, CaptchaVerifier } from '../security/captcha.js';

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
