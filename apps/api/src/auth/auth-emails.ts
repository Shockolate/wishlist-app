import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../core/env.js';
import type { EmailMessage } from '../email/email-sender.js';
import { Mailer } from '../email/mailer.js';

export const SUBJECTS = {
  verification: 'Confirm your email for Hanker',
  accountExists: 'You already have a Hanker account',
  passwordReset: 'Reset your Hanker password',
} as const;

type Rendered = Omit<EmailMessage, 'to'>;

interface Link {
  label: string;
  href: string;
}

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

/** Plain text first; the HTML says the same words, with every value escaped. */
function compose(
  subject: string,
  intro: readonly string[],
  links: readonly Link[],
  footer: string,
): Rendered {
  return {
    subject,
    text: [...intro, ...links.map((l) => `${l.label}: ${l.href}`), footer].join('\n\n'),
    html: [
      ...intro.map((p) => `<p>${escapeHtml(p)}</p>`),
      ...links.map((l) => `<p><a href="${escapeHtml(l.href)}">${escapeHtml(l.label)}</a></p>`),
      `<p>${escapeHtml(footer)}</p>`,
    ].join('\n'),
  };
}

/** No greeting: the display name is unverified, so it can't speak in Hanker's voice (rule 14). */
export function verificationEmail(appOrigin: string, token: string): Rendered {
  return compose(
    SUBJECTS.verification,
    ['Welcome to Hanker. Confirm your email address to start your wishlist.'],
    [{ label: 'Confirm your email', href: `${appOrigin}/verify-email?token=${token}` }],
    "This link expires in 24 hours. If you didn't sign up, ignore this email.",
  );
}

export function accountExistsEmail(appOrigin: string): Rendered {
  return compose(
    SUBJECTS.accountExists,
    ['Someone tried to sign up for Hanker with this email address, but it already has an account.'],
    [
      { label: 'Log in', href: `${appOrigin}/login` },
      { label: 'Forgot your password? Reset it', href: `${appOrigin}/reset-password` },
    ],
    "If this wasn't you, ignore this email. Nothing has changed.",
  );
}

export function passwordResetEmail(appOrigin: string, token: string): Rendered {
  return compose(
    SUBJECTS.passwordReset,
    ['Use this link to choose a new password. It works once, within one hour.'],
    [{ label: 'Reset your password', href: `${appOrigin}/reset-password/confirm?token=${token}` }],
    "Resetting signs you out on every device. If you didn't ask for this, ignore this email.",
  );
}

/** Queues the account emails (spec §5). Their links point at the web app, APP_ORIGIN. */
@Injectable()
export class AuthEmails {
  constructor(
    @Inject(Mailer) private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
  ) {}

  verification(to: string, token: string): void {
    this.mailer.queue({ to, ...verificationEmail(this.env.APP_ORIGIN, token) });
  }

  accountExists(to: string): void {
    this.mailer.queue({ to, ...accountExistsEmail(this.env.APP_ORIGIN) });
  }

  passwordReset(to: string, token: string): void {
    this.mailer.queue({ to, ...passwordResetEmail(this.env.APP_ORIGIN, token) });
  }
}
