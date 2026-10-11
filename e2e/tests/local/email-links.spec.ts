import { expect, test } from '@playwright/test';
import { logInViaApi, signUpViaApi, uniqueEmail } from '../../support/accounts.js';
import { emailsTo, linkPath, waitForEmail } from '../../support/mailpit.js';
import { passTurnstile } from '../../support/turnstile.js';

const VERIFY = 'Confirm your email for Hanker';
const RESET = 'Reset your Hanker password';
const NEW_PASSWORD = 'a brand new passphrase 2';

test('a verification link is used only when the person presses Confirm, and never shows or leaks its token (Review Focus 1, 3)', async ({
  page,
  baseURL,
}) => {
  const email = uniqueEmail('verify');
  await signUpViaApi(page.request, baseURL ?? '', email);
  const link = linkPath((await waitForEmail(email, VERIFY)).text, '/verify-email');

  // A mail scanner or a preview renders the page: nothing is used up.
  const res = await page.goto(link);
  expect(res?.headers()['referrer-policy']).toBe('no-referrer');
  expect(res?.headers()['x-robots-tag']).toBe('noindex');
  await expect(page.getByRole('button', { name: 'Confirm my email' })).toBeVisible();
  await expect.poll(() => page.url()).not.toContain('token=');
  await page.goto('/');

  await page.goto(link);
  await page.getByRole('button', { name: 'Confirm my email' }).click();
  const confirmed = page.getByRole('heading', { name: 'Your email is confirmed.' });
  await expect(confirmed).toBeVisible();
  await expect(confirmed).toBeFocused();

  // The same link again is spent, and the page offers a new one.
  await page.goto(link);
  await page.getByRole('button', { name: 'Confirm my email' }).click();
  await expect(
    page.getByRole('heading', { name: 'This link has expired or has already been used.' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send a new link' })).toBeVisible();
});

test('Back to a token page shows its button again, because stripping the token keeps the router’s history entry', async ({
  page,
}) => {
  // A well-formed token that is never pressed, so no email or account is needed.
  await page.goto(`/verify-email?token=${'A'.repeat(43)}`);
  await expect(page.getByRole('button', { name: 'Confirm my email' })).toBeVisible();
  await expect.poll(() => page.url()).not.toContain('token=');

  await page.getByRole('link', { name: 'Log in' }).click();
  await expect(page).toHaveURL('/login');
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Confirm my email' })).toBeVisible();
});

test('sends a new verification link from /verify-email', async ({ page, baseURL }) => {
  const email = uniqueEmail('resend');
  await signUpViaApi(page.request, baseURL ?? '', email);
  await waitForEmail(email, VERIFY);
  await page.goto('/verify-email');
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await passTurnstile(page);
  await page.getByRole('button', { name: 'Send a new link' }).click();
  await expect(page.getByRole('status')).toContainText('a new link is on its way');
  await expect(page.getByRole('status')).toBeFocused();
  await expect
    .poll(async () => (await emailsTo(email)).filter((m) => m.Subject === VERIFY).length)
    .toBe(2);
});

test('resets a forgotten password, and the new one logs in', async ({ page, baseURL }) => {
  const email = uniqueEmail('reset');
  await signUpViaApi(page.request, baseURL ?? '', email);
  await page.goto('/reset-password');
  await page.getByLabel('Email').fill(email);
  await passTurnstile(page);
  await page.getByRole('button', { name: 'Send the link' }).click();
  await expect(page.getByRole('status')).toContainText('a link is on its way');
  await expect(page.getByRole('status')).toBeFocused();

  const res = await page.goto(
    linkPath((await waitForEmail(email, RESET)).text, '/reset-password/confirm'),
  );
  expect(res?.headers()['referrer-policy']).toBe('no-referrer');
  await expect.poll(() => page.url()).not.toContain('token=');
  await page.getByLabel('New password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Save the new password' }).click();
  const changed = page.getByRole('heading', { name: 'Your password is changed.' });
  await expect(changed).toBeVisible();
  await expect(changed).toBeFocused();
  expect(await logInViaApi(page.request, baseURL ?? '', email, NEW_PASSWORD)).toBe(204);
});
