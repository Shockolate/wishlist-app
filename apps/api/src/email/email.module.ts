import { Module } from '@nestjs/common';
import { ENV, type Env } from '../core/env.js';
import { EMAIL_SENDER, type EmailSender } from './email-sender.js';
import { LogEmailSender } from './log-email-sender.js';
import { Mailer } from './mailer.js';
import { MailpitEmailSender } from './mailpit-email-sender.js';
import { ResendEmailSender } from './resend-email-sender.js';

/** The adapter EMAIL_TRANSPORT names (spec §10 Environments: Mailpit locally, log in previews). */
export function emailSenderFor(env: Env): EmailSender {
  switch (env.EMAIL_TRANSPORT) {
    case 'resend':
      if (!env.RESEND_API_KEY)
        throw new Error('RESEND_API_KEY is required for EMAIL_TRANSPORT=resend');
      return new ResendEmailSender(env.RESEND_API_KEY, env.EMAIL_FROM);
    case 'mailpit':
      return new MailpitEmailSender(env.MAILPIT_URL, env.EMAIL_FROM);
    case 'log':
      return new LogEmailSender();
  }
}

@Module({
  providers: [{ provide: EMAIL_SENDER, inject: [ENV], useFactory: emailSenderFor }, Mailer],
  exports: [Mailer],
})
export class EmailModule {}
