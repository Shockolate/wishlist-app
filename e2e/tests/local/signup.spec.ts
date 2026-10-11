import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, uniqueEmail } from '../../support/accounts.js';
import { emailsTo, waitForEmail } from '../../support/mailpit.js';
import { passTurnstile } from '../../support/turnstile.js';

const VERIFY = 'Confirm your email for Hanker';

async function fillSignup(page: Page, email: string) {
  await page.goto('/signup');
  await page.getByLabel('Your name').fill('Ada');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await passTurnstile(page);
}

test('signs up, and the verification email arrives', async ({ page }) => {
  const email = uniqueEmail('signup');
  await fillSignup(page, email);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeFocused();
  await expect(page.getByText(email)).toBeVisible();
  expect((await waitForEmail(email, VERIFY)).text).toContain('/verify-email?token=');
});

test('says what to fix before sending anything', async ({ page }) => {
  await page.goto('/signup');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Enter a name.')).toBeVisible();
  await expect(page.getByText('Enter an email address, like ada@example.com.')).toBeVisible();
  await expect(page.getByText('Use at least 10 characters.')).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true');
});

test('pressing Create account twice sends one request (Plan 2b Review Focus 5)', async ({
  page,
}) => {
  const email = uniqueEmail('double');
  await fillSignup(page, email);
  await page.getByRole('button', { name: 'Create account' }).dblclick();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await waitForEmail(email, VERIFY);
  // A second request would have sent an "already have an account" email by now.
  await page.waitForTimeout(2_000);
  expect(await emailsTo(email)).toHaveLength(1);
});

test('two submits in one moment still send one request (the in-flight guard)', async ({ page }) => {
  const email = uniqueEmail('guard');
  await fillSignup(page, email);
  // requestSubmit() skips the button, so its disabled state can't stop the second submit: only the
  // in-flight guard can.
  await page.locator('form').evaluate((form) => {
    (form as unknown as { requestSubmit(): void }).requestSubmit();
    (form as unknown as { requestSubmit(): void }).requestSubmit();
  });
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await waitForEmail(email, VERIFY);
  await page.waitForTimeout(2_000);
  expect(await emailsTo(email)).toHaveLength(1);
});
