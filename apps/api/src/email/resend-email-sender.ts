import type { ErrorReporter } from '../observability/error-reporter.js';
import type { EmailMessage, EmailSender } from './email-sender.js';

/** Resend's Free plan (D106). Past either quota, Resend refuses every send until it resets. */
const DAILY_QUOTA = 100;
const MONTHLY_QUOTA = 3000;
const WARN_FRACTION = 0.8;

/** Resend's error names are snake_case codes. Anything else is dropped, so no free text leaks. */
const ERROR_NAME = /^[a-z_]{1,64}$/;

/** Resend's REST API (spec §3), through plain fetch, so there's no SDK in the dependency tree. */
export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly reporter: ErrorReporter,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const res = await this.fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const name = await errorName(res);
      throw new Error(`Resend answered ${res.status}${name ? ` ${name}` : ''}`);
    }
    // Resend's own counts of what's used, so they cover every sender on the account (D106). The
    // messages are fixed, so Sentry groups each day's warnings into one issue.
    if (usedCount(res, 'x-resend-daily-quota') >= DAILY_QUOTA * WARN_FRACTION)
      this.reporter.captureWarning('resend daily quota 80% used');
    if (usedCount(res, 'x-resend-monthly-quota') >= MONTHLY_QUOTA * WARN_FRACTION)
      this.reporter.captureWarning('resend monthly quota 80% used');
  }
}

/** The `name` of Resend's error body, e.g. `daily_quota_exceeded`, never its `message`. */
async function errorName(res: Response): Promise<string | undefined> {
  try {
    const body: unknown = await res.json();
    const name = (body as { name?: unknown } | null)?.name;
    return typeof name === 'string' && ERROR_NAME.test(name) ? name : undefined;
  } catch {
    return undefined;
  }
}

/** A quota header's count, or 0 when it's missing or isn't a plain count. */
function usedCount(res: Response, header: string): number {
  const value = res.headers.get(header) ?? '';
  return /^\d{1,9}$/.test(value) ? Number(value) : 0;
}
