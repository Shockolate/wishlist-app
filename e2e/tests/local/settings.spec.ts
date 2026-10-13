import { expect, test, type Page } from '@playwright/test';
import { logInViaApi, PASSWORD, signUpViaApi, uniqueEmail } from '../../support/accounts.js';
import { expectAccessible, expectFitsPhone } from '../../support/a11y.js';
import { verifiedOwner } from '../../support/owner.js';

async function shareUrlOf(page: Page): Promise<string> {
  return ((await (await page.request.get('/api/wishlist')).json()) as { shareUrl: string })
    .shareUrl;
}

test('renames the list, and the list page shows the new name', async ({ page, baseURL }) => {
  await verifiedOwner(page, baseURL ?? '', 'rename');
  await page.goto('/settings');
  await page.getByLabel('List name').fill('Birthday, 2027');
  await page.getByRole('button', { name: 'Save list name' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'List name saved' })).toBeVisible();
  await page.goto('/list');
  await expect(page.getByRole('heading', { level: 1, name: 'Birthday, 2027' })).toBeVisible();
});

test('gets a new share link only after asking, then shows and copies it', async ({
  page,
  baseURL,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await verifiedOwner(page, baseURL ?? '', 'rotate');
  const old = await shareUrlOf(page);
  // The share link is one long unbroken string; it must wrap at phone width.
  await expectFitsPhone(page, '/settings');
  await expect(page.getByText(old)).toBeVisible();

  await page.getByRole('button', { name: 'Get a new link' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Get a new share link?' });
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Keep this link' }).click();
  expect(await shareUrlOf(page)).toBe(old);

  await page.getByRole('button', { name: 'Get a new link' }).click();
  await dialog.getByRole('button', { name: 'Get a new link' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'New link ready. The old one no longer works.' }),
  ).toBeVisible();
  // Focus went back to the button that opened the dialog, not to the page behind it.
  await expect(page.getByRole('button', { name: 'Get a new link' })).toBeFocused();
  const fresh = await shareUrlOf(page);
  expect(fresh).not.toBe(old);
  await expect(page.getByText(fresh)).toBeVisible();

  await page.getByRole('button', { name: 'Copy link' }).click();
  const copied = await page.evaluate(() =>
    (
      globalThis as unknown as { navigator: { clipboard: { readText(): Promise<string> } } }
    ).navigator.clipboard.readText(),
  );
  expect(copied).toBe(fresh);
});

test('deletes the account only from its dialog, with the right password (D38)', async ({
  page,
  baseURL,
}) => {
  await verifiedOwner(page, baseURL ?? '', 'delete-dialog');
  await page.goto('/settings');
  // No password field on the page itself, so autofill can't make deleting one click.
  await expect(page.getByLabel('Your password')).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete account' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete your account?' });
  await expect(dialog.getByLabel('Your password')).toBeFocused();
  await expectAccessible(page);
  await dialog.getByLabel('Your password').fill('not my password');
  await dialog.getByRole('button', { name: 'Delete account' }).click();
  await expect(dialog.getByText('That password isn’t right.')).toBeVisible();
  await dialog.getByLabel('Your password').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Delete account' }).click();
  await expect(page).toHaveURL('/');
});

test('an unconfirmed owner gets no list settings', async ({ page, baseURL }) => {
  const email = uniqueEmail('unverified-settings');
  await signUpViaApi(page.request, baseURL ?? '', email);
  expect(await logInViaApi(page.request, baseURL ?? '', email)).toBe(204);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Share link' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Your name' })).toBeVisible();
});
