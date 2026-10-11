import { expect, test, type Page } from '@playwright/test';
import { logInViaApi, PASSWORD, signUpViaApi, uniqueEmail } from '../../support/accounts.js';

const NEW_PASSWORD = 'a brand new passphrase 2';

/** A new account, logged in. The session cookie lands in the page's browser context. */
async function signedIn(page: Page, baseURL: string, label: string): Promise<string> {
  const email = uniqueEmail(label);
  await signUpViaApi(page.request, baseURL, email);
  expect(await logInViaApi(page.request, baseURL, email)).toBe(204);
  return email;
}

test('the home greets the user, asks an unverified one to confirm, and settings renames them', async ({
  page,
  baseURL,
}) => {
  await signedIn(page, baseURL ?? '', 'home');
  await page.goto('/');
  await expect(page).toHaveURL('/list');
  await expect(page.getByRole('heading', { level: 1, name: 'Hello, Ada.' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Confirm your email to start your list');

  await page.goto('/settings');
  await page.getByLabel('Display name').fill('Ada L.');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Name saved' })).toHaveText('Name saved');
  await page.reload();
  await expect(page.getByLabel('Display name')).toHaveValue('Ada L.');
});

test('changes the password, keeps this device, and the old password stops working', async ({
  page,
  baseURL,
}) => {
  const email = await signedIn(page, baseURL ?? '', 'password');
  await page.goto('/settings');
  await page.getByLabel('Current password').fill('not my password');
  await page.getByLabel('New password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('That password isn’t right.')).toBeVisible();
  // A server-side field error moves focus to the field, so a screen reader reads it (WCAG 3.3.1).
  await expect(page.getByLabel('Current password')).toBeFocused();

  await page.getByLabel('Current password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Password changed' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();

  // A reload drops the router's cache, so walk /list -> /settings by links: those soft navigations
  // fill the cache that Back would restore from.
  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('link', { name: 'Your list' }).click();
  await expect(page).toHaveURL('/list');
  await nav.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL('/settings');

  // A logout that never reaches the API says so, and leaves the person where they were.
  await page.route('**/api/auth/logout', (route) => route.abort());
  await page.getByRole('button', { name: 'Log out' }).click();
  // Filtered by text: Next's route announcer is also role="alert".
  await expect(
    page.getByRole('alert').filter({ hasText: "We couldn't reach Hanker. Check your connection" }),
  ).toBeVisible();
  await expect(page).toHaveURL('/settings');
  await expect(page.getByRole('button', { name: 'Log out' })).toBeEnabled();
  await page.unroute('**/api/auth/logout');

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL('/');
  // Back must not restore the signed-in page from the router's in-memory cache.
  await page.goBack();
  await expect(page).toHaveURL('/login?next=%2Flist');
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  await expect(page.getByText('Hello, Ada.')).toBeHidden();
  expect(await logInViaApi(page.request, baseURL ?? '', email)).toBe(401);
  expect(await logInViaApi(page.request, baseURL ?? '', email, NEW_PASSWORD)).toBe(204);
});

test('deletes the account after the password, and signs out', async ({ page, baseURL }) => {
  const email = await signedIn(page, baseURL ?? '', 'delete');
  await page.goto('/list');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Settings' })
    .click();
  await expect(page).toHaveURL('/settings');
  await page.getByLabel('Your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Delete account' }).click();
  await expect(page).toHaveURL('/');
  // Back must not show the deleted account's pages from the router's in-memory cache.
  await page.goBack();
  await expect(page).toHaveURL('/login?next=%2Flist');
  await page.goto('/settings');
  await expect(page).toHaveURL('/login?next=%2Fsettings');
  expect(await logInViaApi(page.request, baseURL ?? '', email)).toBe(401);
});

test('a stale session cookie leads to login, not a loop (Review Focus 2)', async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([
    {
      name: '__Host-session',
      value: 'A'.repeat(43),
      domain: new URL(baseURL ?? '').hostname,
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto('/');
  await expect(page).toHaveURL('/login?next=%2Flist');
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
});
