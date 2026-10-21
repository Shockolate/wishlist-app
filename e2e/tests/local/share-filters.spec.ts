import { expect, test, type Browser, type Page } from '@playwright/test';
import type { CreateItemRequest } from '@wishlist/contracts';
import { expectAccessible, expectNoSidewaysScroll, PHONE } from '../../support/a11y.js';
import { addItemViaApi, verifiedOwner } from '../../support/owner.js';
import { guest, shareTokenOf } from '../../support/share.js';

type Seed = Partial<CreateItemRequest> & { title: string };
const tagged = (title: string, priceText: string, ...names: string[]): Seed => ({
  title,
  priceText,
  tags: names.map((name) => ({ name })),
});

/**
 * Ada's seven items, most wanted first. Kitchen is on 5, Christmas on 5, Books on 2. With Kitchen
 * and Christmas on, 4 show; $25–50 then leaves the kettle and the cookbook. The mixer's "varies"
 * is never readable, so any band hides it.
 */
const ADAS_LIST: Seed[] = [
  tagged('Enamel kettle', '$48.00', 'Kitchen', 'Christmas'),
  tagged('Chef’s knife', '$140.00', 'Kitchen', 'Christmas'),
  tagged('Spice rack', '$30.00', 'Kitchen'),
  tagged('Baking cookbook', '$25.00', 'Kitchen', 'Books', 'Christmas'),
  tagged('Paperback novel', '$12.00', 'Books'),
  tagged('Advent candle', '$60.00', 'Christmas'),
  tagged('Stand mixer', 'varies', 'Kitchen', 'Christmas'),
];

/** Ada's list from `items`, and a gifter's page open on it. */
async function setUp(page: Page, browser: Browser, base: string, label: string, items: Seed[]) {
  await verifiedOwner(page, base, label);
  for (const item of items) await addItemViaApi(page.request, base, item);
  const token = await shareTokenOf(page.request);
  const context = await guest(browser, base);
  const gifter = await context.newPage();
  await gifter.goto(`/s/${token}`);
  return { token, context, gifter };
}

const row = (page: Page) => page.getByRole('group', { name: 'Filter the list' });
// Role queries leave out hidden elements, so these are the cards a filter leaves showing.
const shownTitles = (page: Page) =>
  page
    .getByRole('list', { name: /items, most wanted first$/ })
    .getByRole('listitem')
    .getByRole('heading', { level: 2 });
const chip = (page: Page, name: string) =>
  row(page).getByRole('button', { name: new RegExp(`^${name}, \\d+ items?$`) });
const pricePill = (page: Page) => row(page).getByRole('button', { name: /price/i });

test('a gifter narrows the list by two tags and a price band, then clears it (design §4)', async ({
  page,
  browser,
  baseURL,
}) => {
  const { gifter } = await setUp(page, browser, baseURL ?? '', 'filters-two-tags', ADAS_LIST);
  await expect(shownTitles(gifter)).toHaveCount(7);
  await expect(row(gifter).getByRole('button')).toHaveText([
    /Any price/,
    /Christmas/,
    /Kitchen/,
    /Books/,
  ]);

  await row(gifter).getByRole('button', { name: 'Kitchen, 5 items' }).click();
  await expect(gifter.getByText('5 of 7 items')).toBeVisible();
  await row(gifter).getByRole('button', { name: 'Christmas, 4 items' }).click();
  await expect(gifter.getByText('4 of 7 items')).toBeVisible();
  await expect(row(gifter).getByRole('button', { name: 'Books, 1 item' })).toBeEnabled();

  await pricePill(gifter).click();
  const menu = gifter.getByRole('group', { name: 'Price' });
  await expect(menu.getByRole('button', { name: 'Any price, 4 items' })).toBeVisible();
  await expect(menu.getByRole('checkbox', { name: 'Under $25, 0 items' })).toBeDisabled();
  await expect(menu.getByRole('checkbox', { name: '$100+, 1 item' })).toBeEnabled();
  await menu.getByRole('checkbox', { name: '$25–50, 2 items' }).check();
  await gifter.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  await expect(pricePill(gifter)).toHaveText(/\$25–50/);
  await expect(shownTitles(gifter)).toHaveText(['Enamel kettle', 'Baking cookbook']);
  await expect(gifter.locator('li').filter({ hasText: 'Stand mixer' })).toBeHidden();
  await expect(gifter.getByText('2 of 7 items')).toBeVisible();
  await expect(row(gifter).getByRole('button', { name: 'Books, 1 item' })).toBeEnabled();
  await expect(row(gifter).getByRole('button', { name: 'Kitchen, 2 items' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await gifter.getByRole('button', { name: 'Clear filters' }).click();
  await expect(shownTitles(gifter)).toHaveCount(7);
  await expect(gifter.getByText(/of 7 items/)).toHaveCount(0);
  await expect(gifter.getByRole('button', { name: 'Clear filters' })).toHaveCount(0);
  await expect(pricePill(gifter)).toHaveText('Any price');
  await expect(chip(gifter, 'Kitchen')).toHaveAttribute('aria-pressed', 'false');
});

test('a claim made with a filter on keeps the filter, the cards and the count (RF1)', async ({
  page,
  browser,
  baseURL,
}) => {
  const { gifter } = await setUp(page, browser, baseURL ?? '', 'filters-claim', ADAS_LIST);
  await chip(gifter, 'Kitchen').click();
  await expect(gifter.getByText('5 of 7 items')).toBeVisible();
  const before = await shownTitles(gifter).allTextContents();

  await gifter
    .getByRole('listitem')
    .filter({ has: gifter.getByRole('heading', { name: 'Spice rack' }) })
    .getByRole('button', { name: 'I’ll get this' })
    .click();
  const sheet = gifter.getByRole('dialog', { name: 'Spice rack' });
  await sheet.getByLabel('Your name').fill('Aunt Sue');
  await sheet.getByRole('button', { name: 'Claim it' }).click();
  // By text, not role: the dialog makes the page behind it inert.
  await expect(gifter.locator('li').filter({ hasText: 'Spice rack' })).toContainText(
    'You’re getting 1',
  );
  await gifter.getByRole('button', { name: 'Back to Ada’s list' }).click();

  await expect(row(gifter).getByRole('button', { name: 'Kitchen, 5 items' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(shownTitles(gifter)).toHaveText(before);
  await expect(gifter.getByText('5 of 7 items')).toBeVisible();
});

test('the row works from the keyboard, and the price menu gives focus back (RF4)', async ({
  page,
  browser,
  baseURL,
}) => {
  const { gifter } = await setUp(page, browser, baseURL ?? '', 'filters-keys', ADAS_LIST);
  await expect(row(gifter)).toBeVisible();
  await gifter.getByRole('heading', { level: 1 }).focus();
  await gifter.keyboard.press('Tab');
  await expect(pricePill(gifter)).toBeFocused();
  for (const name of ['Christmas', 'Kitchen', 'Books']) {
    await gifter.keyboard.press('Tab');
    await expect(chip(gifter, name)).toBeFocused();
  }
  await gifter.keyboard.press('Space');
  await expect(chip(gifter, 'Books')).toHaveAttribute('aria-pressed', 'true');
  await expect(gifter.getByRole('status')).toHaveText('2 of 7 items');
  await expectAccessible(gifter);

  await pricePill(gifter).focus();
  await gifter.keyboard.press('Enter');
  await expect(pricePill(gifter)).toHaveAttribute('aria-expanded', 'true');
  const menu = gifter.getByRole('group', { name: 'Price' });
  await expect(menu).toBeVisible();
  await expectAccessible(gifter);
  await gifter.keyboard.press('Tab');
  await expect(menu.getByRole('checkbox', { name: /^Under \$25,/ })).toBeFocused();
  await gifter.keyboard.press('Space');
  await expect(menu.getByRole('checkbox', { name: /^Under \$25,/ })).toBeChecked();
  await expect(gifter.getByRole('status')).toHaveText('1 of 7 items');

  await gifter.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(pricePill(gifter)).toBeFocused();
  await expect(pricePill(gifter)).toHaveAttribute('aria-expanded', 'false');
  await expectAccessible(gifter);
});

test('at phone width, many long tags scroll inside the row and never the page (RF5)', async ({
  page,
  browser,
  baseURL,
}) => {
  const names = Array.from({ length: 12 }, (_, i) => `Tag number ${i + 1} `.padEnd(30, 'x'));
  expect(names.every((name) => name.length === 30)).toBe(true);
  const { gifter } = await setUp(page, browser, baseURL ?? '', 'filters-phone', [
    {
      title: 'Linen apron',
      priceText: '$40.00',
      tags: names.slice(0, 6).map((name) => ({ name })),
    },
    { title: 'Bread tin', priceText: '$18.00', tags: names.slice(6).map((name) => ({ name })) },
  ]);
  await gifter.setViewportSize(PHONE);
  await gifter.reload();
  await expect(row(gifter).getByRole('button')).toHaveCount(13);
  await expectNoSidewaysScroll(gifter);
  const { scrollWidth, clientWidth } = await row(gifter).evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(scrollWidth).toBeGreaterThan(clientWidth);
  // A 30-character name stays on one line of its chip.
  const last = chip(gifter, names[11] ?? '');
  await last.focus();
  await expect(last).toBeInViewport();
  const height = await last.evaluate((el) => el.getBoundingClientRect().height);
  expect(height).toBeLessThanOrEqual(48);
  await expectNoSidewaysScroll(gifter);
});

test('without JavaScript every card shows and there is no row (design §4, §7)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const { token } = await setUp(page, browser, base, 'filters-no-js', ADAS_LIST);
  const context = await browser.newContext({ baseURL: base, javaScriptEnabled: false });
  const reader = await context.newPage();
  await reader.goto(`/s/${token}`);
  await expect(shownTitles(reader)).toHaveCount(7);
  await expect(row(reader)).toHaveCount(0);
});

test('Ada sees the same row on her own link', async ({ page, browser, baseURL }) => {
  const { token } = await setUp(page, browser, baseURL ?? '', 'filters-owner', ADAS_LIST);
  await page.goto(`/s/${token}`);
  await expect(page.getByRole('list', { name: 'Your items, most wanted first' })).toBeVisible();
  await chip(page, 'Books').click();
  await expect(shownTitles(page)).toHaveText(['Baking cookbook', 'Paperback novel']);
  await expect(page.getByText('2 of 7 items')).toBeVisible();
  await expect(pricePill(page)).toHaveText('Any price');
  await expectAccessible(page);
});

test('a list priced in yen gets tag chips and no price pill', async ({
  page,
  browser,
  baseURL,
}) => {
  const { gifter } = await setUp(page, browser, baseURL ?? '', 'filters-yen', [
    tagged('Tea bowl', '¥1,200', 'Kitchen'),
    tagged('Furoshiki', '¥2,400', 'Gifts'),
    tagged('Notebook', '$5.00', 'Gifts'),
  ]);
  await expect(chip(gifter, 'Gifts')).toBeVisible();
  await expect(chip(gifter, 'Kitchen')).toBeVisible();
  await expect(pricePill(gifter)).toHaveCount(0);
});

test('a list with no tags and no prices has no row', async ({ page, browser, baseURL }) => {
  const { gifter } = await setUp(page, browser, baseURL ?? '', 'filters-none', [
    { title: 'Enamel kettle' },
    { title: 'Pottery class' },
  ]);
  await expect(shownTitles(gifter)).toHaveCount(2);
  // Hydrated: the claim sheet opens, so the row had its chance to appear.
  await gifter
    .getByRole('button', { name: /I’ll get this/ })
    .first()
    .click();
  const sheet = gifter.getByRole('dialog', { name: 'Enamel kettle' });
  await expect(sheet).toBeVisible();
  await gifter.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(row(gifter)).toHaveCount(0);
  await expect(gifter.getByRole('button', { name: /price/i })).toHaveCount(0);
});
