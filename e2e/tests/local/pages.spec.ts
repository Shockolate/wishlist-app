import { expect, test } from '@playwright/test';
import { logInViaApi, signUpViaApi, uniqueEmail } from '../../support/accounts.js';
import { DESKTOP, expectAccessible, expectFitsPhone } from '../../support/a11y.js';

for (const path of [
  '/',
  '/signup',
  '/login',
  '/verify-email',
  '/reset-password',
  '/reset-password/confirm',
  '/no-such-page',
  '/privacy',
  '/terms',
]) {
  test(`${path}: no detectable WCAG 2.2 AA violations, and it fits a phone`, async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(path);
    await expectAccessible(page);
    await expectFitsPhone(page, path);
  });
}

test('sign-up with every field wrong is still accessible', async ({ page }) => {
  await page.goto('/signup');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Enter a name.')).toBeVisible();
  await expectAccessible(page);
});

test('the signed-in pages are accessible and fit a phone', async ({ page, baseURL }) => {
  const email = uniqueEmail('pages');
  await signUpViaApi(page.request, baseURL ?? '', email);
  expect(await logInViaApi(page.request, baseURL ?? '', email)).toBe(204);
  for (const path of ['/list', '/settings']) {
    await page.setViewportSize(DESKTOP);
    await page.goto(path);
    await expectAccessible(page);
    await expectFitsPhone(page, path);
  }
});
