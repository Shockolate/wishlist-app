import { expect, test, type Page } from '@playwright/test';
import { expectAccessible } from '../../support/a11y.js';
import { addItemViaApi, verifiedOwner } from '../../support/owner.js';

const rowsOf = (page: Page) =>
  page.getByRole('list', { name: 'Your items, most wanted first' }).getByRole('listitem');
const status = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });
/** A row's title button: its name starts with the title (the drag handle's and arrows' don't). */
const titleButton = (page: Page, title: string) =>
  page.getByRole('button', { name: new RegExp(`^${title}`) });

test('edits an item in place, and the change survives a reload', async ({ page, baseURL }) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'edit');
  await addItemViaApi(page.request, base, {
    title: 'Kettle',
    url: 'https://hanker-e2e.invalid/kettle',
    priceText: '$40',
    note: 'Blue',
  });
  await page.goto('/list');
  await titleButton(page, 'Kettle').click();
  const row = rowsOf(page).first();
  await expect(row.getByLabel('Title')).toBeFocused();
  await expectAccessible(page);
  await row.getByLabel('Title').fill('Stovetop kettle');
  await row.getByLabel('Price').fill('$48.00');
  await row.getByRole('button', { name: 'More' }).click();
  await row.getByLabel('Note').fill('Green, please');
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(status(page, 'Saved “Stovetop kettle”.')).toBeVisible();
  await expect(titleButton(page, 'Stovetop kettle')).toBeFocused();
  await expect(titleButton(page, 'Stovetop kettle')).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await expect(rowsOf(page).first()).toContainText('$48.00');
  await expect(rowsOf(page).first()).toContainText('2 wanted');
});

test('clearing the link and the photo turns an item into an idea (3a carry)', async ({
  page,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'clear');
  await addItemViaApi(page.request, base, {
    title: 'Kettle',
    url: 'https://hanker-e2e.invalid/kettle',
    imageUrl: 'https://hanker-e2e.invalid/kettle.jpg',
  });
  await page.goto('/list');
  await titleButton(page, 'Kettle').click();
  await page.getByLabel('Link', { exact: true }).fill('');
  await page.getByLabel('Photo link').fill('');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(rowsOf(page).first()).toContainText('An idea');
  const { items } = (await (await page.request.get('/api/wishlist')).json()) as {
    items: { url: string | null; imageUrl: string | null }[];
  };
  expect(items[0]).toMatchObject({ url: null, imageUrl: null });
});

test('says what’s wrong with a field, and Cancel throws the change away', async ({
  page,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'invalid');
  await addItemViaApi(page.request, base, { title: 'Kettle' });
  await page.goto('/list');
  await titleButton(page, 'Kettle').click();
  await page.getByLabel('Title').fill('  ');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Fill this in.')).toBeVisible();
  await expect(page.getByLabel('Title')).toBeFocused();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(titleButton(page, 'Kettle')).toBeFocused();
  await expect(page.getByLabel('Title')).toHaveCount(0);
});

test('one item is open at a time, and unsaved changes aren’t thrown away', async ({
  page,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'one-open');
  await addItemViaApi(page.request, base, { title: 'Kettle' });
  await addItemViaApi(page.request, base, { title: 'Socks' });
  await page.goto('/list');
  await titleButton(page, 'Kettle').click();
  await page.getByLabel('Title').fill('Kettle, blue');
  await titleButton(page, 'Socks').click();
  await expect(status(page, 'Save or cancel the item you’re editing first.')).toBeVisible();
  await expect(page.getByLabel('Title')).toHaveValue('Kettle, blue');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await titleButton(page, 'Socks').click();
  await expect(page.getByLabel('Title')).toHaveValue('Socks');
});

test('deletes only after asking, and moves focus to the next item', async ({ page, baseURL }) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'delete');
  await addItemViaApi(page.request, base, { title: 'Kettle' });
  await addItemViaApi(page.request, base, { title: 'Socks' });
  await page.goto('/list');
  await titleButton(page, 'Kettle').click();
  await page.getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete “Kettle”?' });
  await expect(dialog).toBeVisible();
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Keep it' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Delete' })).toBeFocused();
  await expect(rowsOf(page)).toHaveCount(2);

  await page.getByRole('button', { name: 'Delete' }).click();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(status(page, 'Deleted “Kettle”.')).toBeVisible();
  await expect(rowsOf(page)).toHaveCount(1);
  await expect(titleButton(page, 'Socks')).toBeFocused();
  await page.reload();
  await expect(rowsOf(page)).toHaveCount(1);
});

test('an item deleted on another device can’t be saved here (Review Focus 4)', async ({
  page,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'gone');
  const item = await addItemViaApi(page.request, base, { title: 'Kettle' });
  await page.goto('/list');
  await titleButton(page, 'Kettle').click();
  const gone = await page.request.delete(`/api/wishlist/items/${item.id}`, {
    headers: { origin: base },
    data: {},
  });
  expect(gone.status()).toBe(204);
  await page.getByLabel('Title').fill('Kettle, blue');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'That item was already removed, so we’ve reloaded your list.' }),
  ).toBeVisible();
  await expect(rowsOf(page)).toHaveCount(0);
});

test('deleting the only item moves focus to the add box', async ({ page, baseURL }) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'delete-only');
  await addItemViaApi(page.request, base, { title: 'Kettle' });
  await page.goto('/list');
  await titleButton(page, 'Kettle').click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page
    .getByRole('alertdialog', { name: 'Delete “Kettle”?' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(rowsOf(page)).toHaveCount(0);
  await expect(page.getByLabel('Add to your list')).toBeFocused();
});

test('an open item that vanishes in a refetch doesn’t block opening another', async ({
  page,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'vanish');
  const kettle = await addItemViaApi(page.request, base, { title: 'Kettle' });
  await addItemViaApi(page.request, base, { title: 'Socks' });
  await page.goto('/list');
  await titleButton(page, 'Kettle').click();
  await page.getByLabel('Title').fill('Kettle, blue');
  const gone = await page.request.delete(`/api/wishlist/items/${kettle.id}`, {
    headers: { origin: base },
    data: {},
  });
  expect(gone.status()).toBe(204);
  // The focus refetch is what brings the server's list in.
  await expect(async () => {
    await page.evaluate(() => {
      const { document, Event } = globalThis as unknown as {
        document: { dispatchEvent(event: unknown): void };
        Event: new (type: string, init: { bubbles: boolean }) => unknown;
      };
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    });
    await expect(rowsOf(page)).toHaveCount(1, { timeout: 500 });
  }).toPass();
  await titleButton(page, 'Socks').click();
  await expect(page.getByLabel('Title')).toHaveValue('Socks');
  await expect(status(page, 'Save or cancel the item you’re editing first.')).toHaveCount(0);
});

test('Cancel waits while a save is in flight', async ({ page, baseURL }) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'saving');
  await addItemViaApi(page.request, base, { title: 'Kettle' });
  await page.goto('/list');
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/wishlist/items/*', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    await held;
    return route.continue();
  });
  await titleButton(page, 'Kettle').click();
  await page.getByLabel('Title').fill('Kettle, blue');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  release();
  await expect(status(page, 'Saved “Kettle, blue”.')).toBeVisible();
});
