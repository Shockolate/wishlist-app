import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { waitUntil } from '@vercel/functions';
import {
  ERROR_REPORTER,
  NOOP_REPORTER,
  type ErrorReporter,
} from '../observability/error-reporter.js';
import { EMAIL_SENDER, type EmailMessage, type EmailSender } from './email-sender.js';

/**
 * Sends email in the background. Responses never wait on delivery. So their timing can't reveal
 * whether an address has an account, and a provider outage never fails a request (spec §9: the
 * endpoint still returns 202, and the user can resend). On Vercel, waitUntil keeps the function
 * alive until delivery settles. Elsewhere waitUntil does nothing and the promise simply runs on.
 */
@Injectable()
export class Mailer {
  private readonly logger = new Logger('Mailer');

  constructor(
    @Inject(EMAIL_SENDER) private readonly sender: EmailSender,
    @Optional() @Inject(ERROR_REPORTER) private readonly reporter: ErrorReporter = NOOP_REPORTER,
  ) {}

  queue(message: EmailMessage): void {
    const delivery = this.sender.send(message).catch((error: unknown) => {
      // No recipient in the log line: it's personal data. Sentry gets the error itself; neither carries the recipient.
      this.logger.error(
        `delivery of "${message.subject}" failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.reporter.captureException(error);
    });
    waitUntil(delivery);
  }
}
