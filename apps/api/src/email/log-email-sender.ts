import { Logger } from '@nestjs/common';
import type { EmailMessage, EmailSender } from './email-sender.js';

/**
 * Writes emails to the log instead of sending them. Previews use it, because they must never send
 * mail (spec §10). The text, links included, is logged so a reviewer can follow a verification
 * link from the preview's logs. Vercel keeps those for an hour, and only the account owner can
 * read them (spec §6.7).
 */
export class LogEmailSender implements EmailSender {
  private readonly logger = new Logger('Email');

  send(message: EmailMessage): Promise<void> {
    this.logger.log(`to=${message.to} subject="${message.subject}"\n${message.text}`);
    return Promise.resolve();
  }
}
