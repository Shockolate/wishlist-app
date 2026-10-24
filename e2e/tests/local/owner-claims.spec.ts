import { expect, test, type Page } from '@playwright/test';
import type { WishlistResponse } from '@wishlist/contracts';
import { expectAccessible } from '../../support/a11y.js';
import { addItemViaApi, verifiedOwner } from '../../support/owner.js';
import { claimViaApi, guest, shareTokenOf } from '../../support/share.js';

const toggle = (page: Page) => page.getByRole('switch', { name: 'Show how many are claimed' });
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
  const dialog = page.getByRole('alertdialog', { name: 'See how many are claimed?' });
  await expect(dialog).toContainText('you can’t unsee what you’ve seen');
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Keep it a surprise' }).click();
  await expect(toggle(page)).toBeFocused();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
  expect(await setting(page)).toBe(false);
});

test('with claims on, the owner sees how many are claimed on /list and on their link, never who, and gifters are told (D75, D40)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'toggle-on');
  const socks = await addItemViaApi(page.request, base, { title: 'Merino socks', quantity: 5 });
  const token = await shareTokenOf(page.request);
  const sue = (await guest(browser, base)).request;
  const sam = (await guest(browser, base)).request;
  await claimViaApi(sue, base, token, socks.id, { claimerName: 'Aunt Sue', quantity: 2 });
  await claimViaApi(sam, base, token, socks.id, { claimerName: 'Sam', quantity: 1 });

  await page.goto('/list');
  await mainNav(page).getByRole('link', { name: 'Settings' }).click();
  await toggle(page).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Show me' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'You’ll see how many are claimed.' }),
  ).toBeVisible();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
  // The dialog gives focus back to the switch, which must still be enabled when it does.
  await expect(toggle(page)).toBeFocused();
  expect(await setting(page)).toBe(true);

  // Back to the list by a client-side navigation: the cached list must fetch the totals.
  await mainNav(page).getByRole('link', { name: 'Your list' }).click();
  await expect(page.getByText('You can see how many are claimed.')).toBeVisible();
  await expect(row(page, 'Merino socks')).toContainText('3 of 5 claimed');
  await expect(page.locator('main')).not.toContainText('Aunt Sue');
  await expect(page.locator('main')).not.toContainText('Sam');
  await expectAccessible(page);

  await page.goto(`/s/${token}`);
  await expect(
    page.getByText('You’ve chosen to see how many are claimed, but never by whom.'),
  ).toBeVisible();
  await expect(page.getByText('3 of 5 claimed')).toBeVisible();
  await expect(page.locator('main')).not.toContainText('Aunt Sue');
  await expect(page.locator('main')).not.toContainText('Sam');

  const gifter = await (await guest(browser, base)).newPage();
  await gifter.goto(`/s/${token}`);
  await expect(
    gifter.getByText('Ada can see how many are claimed, but never who’s getting them.'),
  ).toBeVisible();
});

test('the owner’s own link still says how many they want, and with claims on, how many are taken (D75)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'toggle-want');
  await addItemViaApi(page.request, base, { title: 'Merino socks', quantity: 3 });
  const mugs = await addItemViaApi(page.request, base, { title: 'Stoneware mugs', quantity: 2 });
  await addItemViaApi(page.request, base, { title: 'Reading lamp' });
  const token = await shareTokenOf(page.request);
  const card = (title: string) => page.getByRole('listitem').filter({ hasText: title });

  // Setting off: the quantity is all the owner's card says, as before D75.
  await page.goto(`/s/${token}`);
  await expect(card('Merino socks')).toContainText('You want 3.');
  await expect(card('Merino socks')).not.toContainText(/claimed/i);
  await expect(card('Reading lamp')).not.toContainText(/You want|claimed/i);

  // Setting on: the total joins it, and a fully claimed item gets the "taken" strip.
  await claimViaApi((await guest(browser, base)).request, base, token, mugs.id, {
    claimerName: 'Aunt Sue',
    quantity: 2,
  });
  const on = await page.request.patch('/api/wishlist', {
    headers: { origin: base },
    data: { showClaimsToOwner: true },
  });
  expect(on.status()).toBe(200);
  await page.goto(`/s/${token}`);
  await expect(card('Merino socks')).toContainText('You want 3.');
  await expect(card('Merino socks')).toContainText('None claimed yet');
  await expect(card('Stoneware mugs')).toContainText('You want 2.');
  await expect(card('Stoneware mugs')).toContainText('All 2 claimed');
  await expect(page.locator('main')).not.toContainText('Aunt Sue');
});

test('while on, an edit keeps its row’s claim line, and a new item has none yet (Plan 4b rule 13)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'toggle-edit');
  const kettle = await addItemViaApi(page.request, base, { title: 'Enamel kettle', quantity: 5 });
  const token = await shareTokenOf(page.request);
  await claimViaApi((await guest(browser, base)).request, base, token, kettle.id, {
    claimerName: 'Aunt Sue',
    quantity: 2,
  });
  await claimViaApi((await guest(browser, base)).request, base, token, kettle.id, {
    claimerName: 'Sam',
    quantity: 1,
  });
  const on = await page.request.patch('/api/wishlist', {
    headers: { origin: base },
    data: { showClaimsToOwner: true },
  });
  expect(on.status()).toBe(200);

  await page.goto('/list');
  // The row is found by its title button's text, which keeps the old title until the save lands.
  const kettleRow = row(page, 'Enamel kettle');
  await expect(kettleRow).toContainText('3 of 5 claimed');
  await kettleRow.getByRole('button', { name: /^Enamel kettle/ }).click();
  await kettleRow.getByLabel('Title', { exact: true }).fill('Enamel stovetop kettle');
  // 'More' is the quantity stepper's + button: 5 becomes 6.
  await kettleRow.getByRole('button', { name: 'More' }).click();
  await kettleRow.getByRole('button', { name: 'Save' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Saved “Enamel stovetop kettle”.' }),
  ).toBeVisible();
  // Six wanted now, three claimed, with no reload: the line is worked out from the cached total.
  await expect(row(page, 'Enamel stovetop kettle')).toContainText('3 of 6 claimed');

  await page.getByLabel('Add to your list').fill('Pottery class for two');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Add to list' }).click();
  await expect(row(page, 'Pottery class for two')).toContainText('None claimed yet');
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
  await expect(row(page, 'Enamel kettle')).toContainText('Claimed');
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
  // Saving must not take focus off the switch (a disabled button can't keep it).
  await expect(toggle(page)).toBeFocused();
  await mainNav(page).getByRole('link', { name: 'Your list' }).click();
  await expect(row(page, 'Enamel kettle')).toBeVisible();
  await expect(page.getByText('Aunt Sue')).toHaveCount(0);
  await expect(row(page, 'Enamel kettle')).not.toContainText(/claimed/i);
  await expect(page.getByText('You can see how many are claimed.')).toHaveCount(0);
});

test('a list fetch still in flight when claims are turned off can’t bring them back (spoiler guarantee)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'toggle-inflight');
  const kettle = await addItemViaApi(page.request, base, { title: 'Enamel kettle' });
  const token = await shareTokenOf(page.request);
  await claimViaApi((await guest(browser, base)).request, base, token, kettle.id, {
    claimerName: 'Aunt Sue',
  });
  await page.request.patch('/api/wishlist', {
    headers: { origin: base },
    data: { showClaimsToOwner: true },
  });

  // Hold the mount refetch: it reads the list for real, now, with the claims in it, and answers
  // only when released. Every later list fetch is held forever, so only the cache can be shown.
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => (release = resolve));
  let held: () => void = () => undefined;
  const heldGet = new Promise<void>((resolve) => (held = resolve));
  let answered: () => void = () => undefined;
  const lateAnswer = new Promise<void>((resolve) => (answered = resolve));
  let first = true;
  await page.route('**/api/wishlist', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    if (!first) return new Promise<void>(() => undefined);
    first = false;
    const real = await route.fetch();
    held();
    await released;
    await route.fulfill({ response: real });
    answered();
  });

  await page.goto('/list');
  await heldGet;
  await mainNav(page).getByRole('link', { name: 'Settings' }).click();
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
  await expect(
    page.getByRole('status').filter({ hasText: 'Claims are hidden from you again.' }),
  ).toBeVisible();

  // The old answer arrives late, claims and all.
  release();
  await lateAnswer;
  await mainNav(page).getByRole('link', { name: 'Your list' }).click();
  await expect(row(page, 'Enamel kettle')).toBeVisible();
  await expect(page.getByText('Aunt Sue')).toHaveCount(0);
  await expect(row(page, 'Enamel kettle')).not.toContainText(/claimed/i);
  await expect(page.getByText('You can see how many are claimed.')).toHaveCount(0);
});
