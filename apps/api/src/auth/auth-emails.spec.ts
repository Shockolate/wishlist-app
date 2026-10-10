import { describe, expect, it } from 'vitest';
import {
  accountExistsEmail,
  passwordResetEmail,
  SUBJECTS,
  verificationEmail,
} from './auth-emails.js';

const ORIGIN = 'https://wishlist.example';
const TOKEN = 'T'.repeat(43);

describe('account emails', () => {
  it('links verification to /verify-email with the token, in text and in HTML', () => {
    const email = verificationEmail(ORIGIN, TOKEN);
    expect(email.subject).toBe(SUBJECTS.verification);
    expect(email.text).toContain(`${ORIGIN}/verify-email?token=${TOKEN}`);
    expect(email.html).toContain(`href="${ORIGIN}/verify-email?token=${TOKEN}"`);
    expect(email.text).not.toMatch(/^Hi\b/m);
  });

  it('escapes every value it puts into HTML', () => {
    const { html } = passwordResetEmail('https://x.example/?a=1&b=<2>', TOKEN);
    expect(html).toContain('https://x.example/?a=1&amp;b=&lt;2&gt;');
    expect(html).not.toContain('<2>');
  });

  it('answers a signup for an existing account with links to log in and to reset, and no token', () => {
    const email = accountExistsEmail(ORIGIN);
    expect(email.subject).toBe(SUBJECTS.accountExists);
    expect(email.text).toContain(`${ORIGIN}/login`);
    expect(email.text).toContain(`${ORIGIN}/reset-password`);
    expect(email.text).not.toContain('token=');
  });

  it('links a reset to /reset-password/confirm with the token', () => {
    const email = passwordResetEmail(ORIGIN, TOKEN);
    expect(email.subject).toBe(SUBJECTS.passwordReset);
    expect(email.text).toContain(`${ORIGIN}/reset-password/confirm?token=${TOKEN}`);
  });
});
