import { expect, test } from '@playwright/test';
import { PASSWORD, uniqueEmail } from '../../support/accounts.js';
import { linkPath, waitForEmail } from '../../support/mailpit.js';
import { passTurnstile } from '../../support/turnstile.js';

const VERIFY = 'Confirm your email for Hanker';
const RESET = 'Reset your Hanker password';
const NEW_PASSWORD = 'a brand new passphrase 2';

test('a new person signs up, confirms, logs in, renames, resets the password and leaves (spec §8)', async ({
  page,
}) => {
  // Two Turnstile passes and two mail waits can each take 15 s, more than the default 30 s.
  test.slow();
  const email = uniqueEmail('golden');
  const mainNav = page.getByRole('navigation', { name: 'Main' });

  await page.goto('/');
  await page.getByRole('link', { name: 'Create your list' }).click();
  await expect(page).toHaveURL('/signup');
  await page.getByLabel('Your name').fill('Ada');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await passTurnstile(page);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  await page.goto(linkPath((await waitForEmail(email, VERIFY)).text, '/verify-email'));
  await page.getByRole('button', { name: 'Confirm my email' }).click();
  await page.getByRole('link', { name: 'Go to your list' }).click();

  // Signing up doesn't log you in: the list sends you to login, and back.
  await expect(page).toHaveURL('/login?next=%2Flist');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Hello, Ada.' })).toBeVisible();
  await expect(page.getByText('Confirm your email to start your list')).toHaveCount(0);

  await mainNav.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('Display name').fill('Ada Lovelace');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Name saved' })).toHaveText('Name saved');

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL('/');
  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  await expect(page).toHaveURL('/reset-password');
  await page.getByLabel('Email').fill(email);
  await passTurnstile(page);
  await page.getByRole('button', { name: 'Send the link' }).click();
  await expect(page.getByRole('status')).toContainText('a link is on its way');

  await page.goto(linkPath((await waitForEmail(email, RESET)).text, '/reset-password/confirm'));
  await page.getByLabel('New password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Save the new password' }).click();
  await page.getByRole('link', { name: 'Go to login' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Hello, Ada Lovelace.' })).toBeVisible();

  await mainNav.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('Your password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Delete account' }).click();
  await expect(page).toHaveURL('/');
});
