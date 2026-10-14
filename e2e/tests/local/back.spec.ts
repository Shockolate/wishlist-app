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

/**
 * Holds the editor's next `GET /api/wishlist` answers for a while, so whatever the page shows before
 * they land can only have come from its own cache, not from a refetch that happened to be quick.
 */
async function holdListRefetches(page: Page) {
  await page.route('**/api/wishlist', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    return route.fulfill({ response });
  });
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

  // Back restores the list's render from before the rotation, and its refetch is held: the cached
  // list itself must already carry the new link (final review N2).
  await holdListRefetches(page);
  await page.goBack();
  await expect(page).toHaveURL('/list');
  await page.getByRole('button', { name: 'Copy share link' }).click();
  await expect(status(page, 'Link copied.')).toBeVisible();
  expect(await clipboardOf(page)).toBe(fresh);

  // And the same when the list is reached by its link.
  await page.unroute('**/api/wishlist');
  await mainNav(page).getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL('/settings');
  await mainNav(page).getByRole('link', { name: 'Your list' }).click();
  await expect(page).toHaveURL('/list');
  await page.getByRole('button', { name: 'Copy share link' }).click();
  await expect(status(page, 'Link copied.')).toBeVisible();
  expect(await clipboardOf(page)).toBe(fresh);
});

test('after a rename, Back shows the new name before any refetch (N2)', async ({
  page,
  baseURL,
  context,
}) => {
  const base = baseURL ?? '';
  await owner(page, context, base, 'back-rename');
  await addItemViaApi(page.request, base, { title: 'Kettle' });
  await page.goto('/list');
  await expect(page.getByRole('heading', { level: 1, name: "Ada's wishlist" })).toBeVisible();

  await mainNav(page).getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('List name').fill('Birthday, 2027');
  await page.getByRole('button', { name: 'Save list name' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'List name saved' })).toBeVisible();

  await holdListRefetches(page);
  await page.goBack();
  await expect(page).toHaveURL('/list');
  await expect(page.getByRole('heading', { level: 1, name: 'Birthday, 2027' })).toBeVisible({
    timeout: 1_000,
  });
});

test('Back after more than five minutes elsewhere still shows the saved edit (N3)', async ({
  page,
  baseURL,
  context,
}) => {
  const base = baseURL ?? '';
  // TanStack forgets an unused query after its gcTime, five minutes by default.
  await page.clock.install();
  await owner(page, context, base, 'back-later');
  await addItemViaApi(page.request, base, { title: 'Kettle', priceText: '$40' });
  await page.goto('/list');
  await titleButton(page, 'Kettle').click();
  await page.getByLabel('Price').fill('$48.00');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(status(page, 'Saved “Kettle”.')).toBeVisible();

  await mainNav(page).getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL('/settings');
  await page.clock.fastForward('06:00');

  await holdListRefetches(page);
  await page.goBack();
  await expect(page).toHaveURL('/list');
  await titleButton(page, 'Kettle').click();
  await expect(page.getByLabel('Price')).toHaveValue('$48.00', { timeout: 1_000 });
});

test('someone signing in from another tab never sees the last account’s list (N4)', async ({
  page,
  baseURL,
  context,
}) => {
  const base = baseURL ?? '';
  await owner(page, context, base, 'tab-first');
  await addItemViaApi(page.request, base, { title: 'First account’s secret' });
  await page.goto('/list');
  await expect(rowsOf(page)).toHaveCount(1);

  // Another tab in the same browser signs in as someone else; the cookie is shared.
  const otherTab = await context.newPage();
  await verifiedOwner(otherTab, base, 'tab-second');
  await addItemViaApi(otherTab.request, base, { title: 'Second account’s item' });
  await otherTab.close();

  await holdListRefetches(page);
  await mainNav(page).getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL('/settings');
  await mainNav(page).getByRole('link', { name: 'Your list' }).click();
  await expect(page).toHaveURL('/list');
  await expect(rowsOf(page)).toHaveCount(1);
  await expect(rowsOf(page).first()).toContainText('Second account’s item', { timeout: 1_000 });
  await expect(page.getByText('First account’s secret')).toHaveCount(0);
});
