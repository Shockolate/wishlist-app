import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { addItemViaApi, verifiedOwner } from '../../support/owner.js';

// Next restores a page's server render from its router cache on Back, so /list must not trust the
// render it is seeded with (Plan 3b final review, C1).

const rowsOf = (page: Page) =>
  page.getByRole('list', { name: 'Your items, most wanted first' }).getByRole('listitem');
const status = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });
const titleButton = (page: Page, title: string) =>
  page.getByRole('button', { name: new RegExp(`^${title}`) });
const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main' });

async function shareUrlOf(page: Page): Promise<string> {
  return ((await (await page.request.get('/api/wishlist')).json()) as { shareUrl: string })
    .shareUrl;
}

async function clipboardOf(page: Page): Promise<string> {
  // e2e has no DOM lib, so the page's globals are typed by hand.
  return page.evaluate(() =>
    (
      globalThis as unknown as { navigator: { clipboard: { readText(): Promise<string> } } }
    ).navigator.clipboard.readText(),
  );
}

async function owner(page: Page, context: BrowserContext, baseURL: string, label: string) {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await verifiedOwner(page, baseURL, label);
}

test('Back to the list shows an edit made before leaving, and a save from it keeps the edit', async ({
  page,
  baseURL,
  context,
}) => {
  const base = baseURL ?? '';
  await owner(page, context, base, 'back-edit');
  await addItemViaApi(page.request, base, { title: 'Kettle', priceText: '$40', note: 'Blue' });
  await page.goto('/list');
  await titleButton(page, 'Kettle').click();
  await page.getByLabel('Price').fill('$48.00');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(status(page, 'Saved “Kettle”.')).toBeVisible();

  await mainNav(page).getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL('/settings');
  await page.goBack();
  await expect(page).toHaveURL('/list');
  await titleButton(page, 'Kettle').click();
  await expect(page.getByLabel('Price')).toHaveValue('$48.00');

  // Saving only the note must not put the old price back (the form sends all six fields).
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByLabel('Note').fill('Green');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(status(page, 'Saved “Kettle”.')).toBeVisible();
  const { items } = (await (await page.request.get('/api/wishlist')).json()) as {
    items: { priceText: string | null; note: string | null }[];
  };
  expect(items[0]).toMatchObject({ priceText: '$48.00', note: 'Green' });
});

test('Back to the list shows an item added before leaving', async ({ page, baseURL, context }) => {
  const base = baseURL ?? '';
  await owner(page, context, base, 'back-add');
  await addItemViaApi(page.request, base, { title: 'Kettle' });
  await page.goto('/list');
  await page.getByLabel('Add to your list').fill('Pottery class');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(status(page, 'Added “Pottery class”.')).toBeVisible();
  await expect(rowsOf(page)).toHaveCount(2);

  await mainNav(page).getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL('/settings');
  await page.goBack();
  await expect(page).toHaveURL('/list');
  await expect(rowsOf(page)).toHaveCount(2);
  await expect(rowsOf(page).nth(1)).toContainText('Pottery class');
});

test('after a new link, the list copies the new one, not the one it was rendered with', async ({
  page,
  baseURL,
  context,
}) => {
  const base = baseURL ?? '';
  await owner(page, context, base, 'back-link');
  await addItemViaApi(page.request, base, { title: 'Kettle' });
  const old = await shareUrlOf(page);
  await page.goto('/list');
  await expect(page.getByRole('button', { name: 'Copy share link' })).toBeVisible();

  await mainNav(page).getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Get a new link' }).click();
  await page
    .getByRole('alertdialog', { name: 'Get a new share link?' })
    .getByRole('button', { name: 'Get a new link' })
    .click();
  await expect(status(page, 'New link ready. The old one no longer works.')).toBeVisible();
  const fresh = await shareUrlOf(page);
  expect(fresh).not.toBe(old);

  // Back restores the list's render from before the rotation.
  await page.goBack();
  await expect(page).toHaveURL('/list');
  await page.getByRole('button', { name: 'Copy share link' }).click();
  await expect(status(page, 'Link copied.')).toBeVisible();
  expect(await clipboardOf(page)).toBe(fresh);

  // And the same when the list is reached by its link.
  await mainNav(page).getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL('/settings');
  await mainNav(page).getByRole('link', { name: 'Your list' }).click();
  await expect(page).toHaveURL('/list');
  await page.getByRole('button', { name: 'Copy share link' }).click();
  await expect(status(page, 'Link copied.')).toBeVisible();
  expect(await clipboardOf(page)).toBe(fresh);
});
