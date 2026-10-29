import { describe, expect, it } from 'vitest';
import { NOOP_REPORTER } from '../observability/error-reporter.js';
import { testEnv } from '../testing/test-env.js';
import { emailSenderFor } from './email.module.js';
import { LogEmailSender } from './log-email-sender.js';
import { MailpitEmailSender } from './mailpit-email-sender.js';
import { ResendEmailSender } from './resend-email-sender.js';

describe('emailSenderFor', () => {
  it('picks the adapter EMAIL_TRANSPORT names', () => {
    expect(emailSenderFor(testEnv({ EMAIL_TRANSPORT: 'log' }), NOOP_REPORTER)).toBeInstanceOf(
      LogEmailSender,
    );
    expect(emailSenderFor(testEnv({ EMAIL_TRANSPORT: 'mailpit' }), NOOP_REPORTER)).toBeInstanceOf(
      MailpitEmailSender,
    );
    expect(
      emailSenderFor(
        testEnv({ EMAIL_TRANSPORT: 'resend', RESEND_API_KEY: 're_test' }),
        NOOP_REPORTER,
      ),
    ).toBeInstanceOf(ResendEmailSender);
  });
});
