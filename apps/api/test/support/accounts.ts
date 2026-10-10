import { SUBJECTS } from '../../src/auth/auth-emails.js';
import type { EmailMessage } from '../../src/email/email-sender.js';
import type { AuthTestApp } from './auth-app.js';
import { client, linkToken } from './client.js';

export interface Account {
  email: string;
  password: string;
  displayName: string;
}

export const ADA: Account = {
  email: 'ada@example.com',
  password: 'correct horse battery 1',
  displayName: 'Ada',
};

/** Any token works against FakeCaptcha. Tests flip `t.captcha.verdict` to fail it. */
export const TURNSTILE_OK = 'turnstile-ok';

/** The last email with this subject sent to this address. */
export function lastEmail(t: AuthTestApp, to: string, subject: string): EmailMessage {
  const message = t.emails.sent.findLast((m) => m.to === to && m.subject === subject);
  if (!message) throw new Error(`no "${subject}" email to ${to}`);
  return message;
}

export async function signUp(t: AuthTestApp, account: Account = ADA): Promise<void> {
  const res = await client(t.app).post('/auth/signup', {
    ...account,
    turnstileToken: TURNSTILE_OK,
  });
  if (res.status !== 202) throw new Error(`signup answered ${res.status}`);
}

/** Signs up, then follows the emailed verification link. */
export async function signUpVerified(t: AuthTestApp, account: Account = ADA): Promise<void> {
  await signUp(t, account);
  const token = linkToken(lastEmail(t, account.email, SUBJECTS.verification).text);
  const res = await client(t.app).post('/auth/verify-email', { token });
  if (res.status !== 204) throw new Error(`verify answered ${res.status}`);
}
