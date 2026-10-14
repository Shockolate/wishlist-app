import { expect, test, type Page } from '@playwright/test';
import type { WishlistResponse } from '@wishlist/contracts';
import { expectAccessible } from '../../support/a11y.js';
import { addItemViaApi, verifiedOwner } from '../../support/owner.js';
import { claimViaApi, guest, shareTokenOf } from '../../support/share.js';

const toggle = (page: Page) => page.getByRole('switch', { name: 'Show me who’s getting what' });
const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const row = (page: Page, title: string) =>
  page
    .getByRole('list', { name: 'Your items, most wanted first' })
    .getByRole('listitem')
    .filter({ hasText: title });
const setting = async (page: Page) =>
  ((await (await page.request.get('/api/wishlist')).json()) as WishlistResponse).showClaimsToOwner;

test('turning claims on asks first, and keeping the surprise changes nothing (spec §2 Spoilers)', async ({
  page,
  baseURL,
}) => {
  await verifiedOwner(page, baseURL ?? '', 'toggle-ask');
  await page.goto('/settings');
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
  await toggle(page).click();
  const dialog = page.getByRole('alertdialog', { name: 'See who’s getting what?' });
  await expect(dialog).toContainText('you can’t unsee what you’ve seen');
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Keep it a surprise' }).click();
  await expect(toggle(page)).toBeFocused();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
  expect(await setting(page)).toBe(false);
});

test('with claims on, the owner sees them on /list and on their link, and gifters are told (D33, D40)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'toggle-on');
  const kettle = await addItemViaApi(page.request, base, { title: 'Enamel kettle' });
  const socks = await addItemViaApi(page.request, base, { title: 'Merino socks', quantity: 3 });
  const token = await shareTokenOf(page.request);
  const sue = (await guest(browser, base)).request;
  await claimViaApi(sue, base, token, kettle.id, { claimerName: 'Aunt Sue' });
  await claimViaApi(sue, base, token, socks.id, { claimerName: 'Sam' });

  await page.goto('/list');
  await mainNav(page).getByRole('link', { name: 'Settings' }).click();
  await toggle(page).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Show me' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'You’ll see who’s getting what.' }),
  ).toBeVisible();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
  expect(await setting(page)).toBe(true);

  // Back to the list by a client-side navigation: the cached list must fetch the claims.
  await mainNav(page).getByRole('link', { name: 'Your list' }).click();
  await expect(page.getByText('You can see who’s getting what.')).toBeVisible();
  await expect(row(page, 'Enamel kettle')).toContainText('Aunt Sue is getting this');
  await expect(row(page, 'Merino socks')).toContainText('Sam ×1 · 2 left');
  await expectAccessible(page);

  await page.goto(`/s/${token}`);
  await expect(page.getByText('You’ve chosen to see who’s getting what.')).toBeVisible();
  await expect(page.getByText('Taken care of: Aunt Sue is getting this')).toBeVisible();

  const gifter = await (await guest(browser, base)).newPage();
  await gifter.goto(`/s/${token}`);
  await expect(gifter.getByText('Ada can see who’s getting what.')).toBeVisible();
});

test('while on, an edit keeps its row’s claim line, and a new item has none yet (Plan 4b rule 13)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'toggle-edit');
  const kettle = await addItemViaApi(page.request, base, { title: 'Enamel kettle' });
  const token = await shareTokenOf(page.request);
  await claimViaApi((await guest(browser, base)).request, base, token, kettle.id, {
    claimerName: 'Aunt Sue',
  });
  const on = await page.request.patch('/api/wishlist', {
    headers: { origin: base },
    data: { showClaimsToOwner: true },
  });
  expect(on.status()).toBe(200);

  await page.goto('/list');
  // The row is found by its title button's text, which keeps the old title until the save lands.
  const kettleRow = row(page, 'Enamel kettle');
  await kettleRow.getByRole('button', { name: /^Enamel kettle/ }).click();
  await kettleRow.getByLabel('Title', { exact: true }).fill('Enamel stovetop kettle');
  await kettleRow.getByRole('button', { name: 'Save' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Saved “Enamel stovetop kettle”.' }),
  ).toBeVisible();
  await expect(row(page, 'Enamel stovetop kettle')).toContainText('Aunt Sue is getting this');

  await page.getByLabel('Add to your list').fill('Pottery class for two');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(row(page, 'Pottery class for two')).toContainText('No claims yet');
});

test('turning claims off hides them at once, with no reload (Review Focus 5)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'toggle-off');
  const kettle = await addItemViaApi(page.request, base, { title: 'Enamel kettle' });
  const token = await shareTokenOf(page.request);
  await claimViaApi((await guest(browser, base)).request, base, token, kettle.id, {
    claimerName: 'Aunt Sue',
  });
  await page.request.patch('/api/wishlist', {
    headers: { origin: base },
    data: { showClaimsToOwner: true },
  });

  await page.goto('/list');
  await expect(row(page, 'Enamel kettle')).toContainText('Aunt Sue is getting this');
  await mainNav(page).getByRole('link', { name: 'Settings' }).click();
  // Hold every list fetch, so only the cache can be what /list shows next.
  await page.route('**/api/wishlist', (route) =>
    route.request().method() === 'GET' ? new Promise(() => undefined) : route.continue(),
  );
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
  await expect(
    page.getByRole('status').filter({ hasText: 'Claims are hidden from you again.' }),
  ).toBeVisible();
  await mainNav(page).getByRole('link', { name: 'Your list' }).click();
  await expect(row(page, 'Enamel kettle')).toBeVisible();
  await expect(page.getByText('Aunt Sue')).toHaveCount(0);
  await expect(page.getByText('You can see who’s getting what.')).toHaveCount(0);
});
