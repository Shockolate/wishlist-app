import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, signUpViaApi, uniqueEmail } from '../../support/accounts.js';

async function logIn(page: Page, email: string, password = PASSWORD) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
}

test('login: plain words for a wrong password, then home; next never leaves the site (Plan 2b Review Focus 4)', async ({
  page,
  baseURL,
}) => {
  const email = uniqueEmail('login');
  await signUpViaApi(page.request, baseURL ?? '', email);

  await page.goto(`/login?next=${encodeURIComponent('//evil.example')}`);
  await logIn(page, email, 'not my password');
  // By text: Next's route announcer also has role="alert".
  await expect(page.getByText("That email and password don't match.")).toBeVisible();
  await logIn(page, email);
  await expect(page).toHaveURL('/list');
  expect((await page.request.get('/api/me')).status()).toBe(200);

  await page.context().clearCookies();
  await page.goto(`/login?next=${encodeURIComponent('/settings')}`);
  await logIn(page, email);
  await expect(page).toHaveURL('/settings');
});
