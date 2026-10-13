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
  // The notice describes the saved value, so it goes as soon as the field is edited again.
  await page.getByLabel('List name').fill('Birthday, 2028');
  await expect(page.getByText('List name saved')).toHaveCount(0);
  await page.getByLabel('List name').fill('Birthday, 2027');
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

  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/wishlist/share-token/rotate', async (route) => {
    await gate;
    await route.continue();
  });
  await page.getByRole('button', { name: 'Get a new link' }).click();
  await dialog.getByRole('button', { name: 'Get a new link' }).click();
  // A confirm made during the request isn't silent.
  await expect(
    page.getByRole('status').filter({ hasText: 'Getting your new link…' }),
  ).toBeVisible();
  release();
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

test('after a new link, Back to Settings shows and copies the new one (final review, I1)', async ({
  page,
  baseURL,
  context,
}) => {
  const base = baseURL ?? '';
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await verifiedOwner(page, base, 'back-settings');
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Get a new link' }).click();
  await page
    .getByRole('alertdialog', { name: 'Get a new share link?' })
    .getByRole('button', { name: 'Get a new link' })
    .click();
  await expect(
    page.getByRole('status').filter({ hasText: 'New link ready. The old one no longer works.' }),
  ).toBeVisible();
  const fresh = await shareUrlOf(page);

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Your list' })
    .click();
  await expect(page).toHaveURL('/list');
  await page.goBack();
  await expect(page).toHaveURL('/settings');
  await expect(page.getByText(fresh)).toBeVisible();
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Link copied.' })).toBeVisible();
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

test('a wrong password refocuses the field, and closing the dialog clears it', async ({
  page,
  baseURL,
}) => {
  await verifiedOwner(page, baseURL ?? '', 'delete-reset');
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Delete account' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete your account?' });
  const password = dialog.getByLabel('Your password');
  await password.fill('not my password');
  await dialog.getByRole('button', { name: 'Delete account' }).click();
  await expect(dialog.getByText('That password isn’t right.')).toBeVisible();
  await expect(password).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Delete account' }).click();
  await expect(password).toHaveValue('');
  await expect(dialog.getByText('That password isn’t right.')).toHaveCount(0);
});

test('the delete dialog cannot be dismissed while the request is on its way', async ({
  page,
  baseURL,
}) => {
  await verifiedOwner(page, baseURL ?? '', 'delete-inflight');
  await page.goto('/settings');
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/me', async (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    await gate;
    return route.continue();
  });
  await page.getByRole('button', { name: 'Delete account' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete your account?' });
  await dialog.getByLabel('Your password').fill('not my password');
  await dialog.getByRole('button', { name: 'Delete account' }).click();
  await expect(dialog.getByRole('button', { name: 'Keep my account' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  release();
  // The failure lands in the dialog that is still open.
  await expect(dialog.getByText('That password isn’t right.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Keep my account' })).toBeEnabled();
});

test('an unconfirmed owner gets no list settings', async ({ page, baseURL }) => {
  const email = uniqueEmail('unverified-settings');
  await signUpViaApi(page.request, baseURL ?? '', email);
  expect(await logInViaApi(page.request, baseURL ?? '', email)).toBe(204);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Share link' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Your name' })).toBeVisible();
});
