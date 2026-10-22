import { expect, test, type Browser, type Page, type Route } from '@playwright/test';
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

test('without JavaScript every card shows and the row is hidden (design §4, §7)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const { token } = await setUp(page, browser, base, 'filters-no-js', ADAS_LIST);
  const context = await browser.newContext({ baseURL: base, javaScriptEnabled: false });
  const reader = await context.newPage();
  await reader.goto(`/s/${token}`);
  // The page's own scripts are off; Playwright's evaluate still runs, so the media query the row's
  // CSS hides it with can be checked directly.
  const scriptingNone = await reader.evaluate(() => {
    const { matchMedia } = globalThis as unknown as {
      matchMedia(query: string): { matches: boolean };
    };
    return matchMedia('(scripting: none)').matches;
  });
  expect(scriptingNone).toBe(true);
  await expect(shownTitles(reader)).toHaveCount(7);
  // The row is in the server HTML, so check it by attribute: a role query would skip it either way.
  const group = reader.locator('[role="group"][aria-label="Filter the list"]');
  await expect(group).toHaveCount(1);
  await expect(group).toBeHidden();
  await expect(reader.getByRole('button', { name: /price|items?$/i })).toHaveCount(0);
});

/** The browser globals `settledTop` uses; the E2E tsconfig has no DOM lib. */
interface LayoutGlobal {
  document: {
    querySelectorAll(selector: string): ArrayLike<{ sheet: unknown }>;
    fonts: { ready: Promise<unknown> };
  };
  requestAnimationFrame(callback: () => void): number;
}

/** Whether React has hydrated `selector`'s element: it then carries a fiber key. */
const hydrated = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => Object.keys(el).some((key) => key.startsWith('__reactFiber$')));

test('the row is in the server HTML, so the cards don’t move when JavaScript loads', async ({
  page,
  browser,
  baseURL,
}) => {
  const { token, context } = await setUp(
    page,
    browser,
    baseURL ?? '',
    'filters-no-shift',
    ADAS_LIST,
  );
  // The app's scripts are held, so the first measurement is the server HTML with its CSS and
  // fonts, before React runs.
  const reader = await context.newPage();
  const held: Route[] = [];
  let release = false;
  await reader.route(/\/_next\/static\/.+\.js(?:\?.*)?$/, async (route) => {
    if (release) await route.continue();
    else held.push(route);
  });
  await reader.goto(`/s/${token}`, { waitUntil: 'domcontentloaded' });
  const firstCard = reader.locator('ol > li').first();
  const settledTop = () =>
    firstCard.evaluate(async (el) => {
      const { document, requestAnimationFrame } = globalThis as unknown as LayoutGlobal;
      const sheets = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
      while (sheets.some((link) => link.sheet === null)) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      el.getBoundingClientRect(); // lays the page out, which starts its fonts loading
      await document.fonts.ready;
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
      return el.getBoundingClientRect().top;
    });
  const before = await settledTop();
  expect(await hydrated(reader, 'ol')).toBe(false);

  release = true;
  await Promise.all(held.map((route) => route.continue()));
  await expect.poll(() => hydrated(reader, 'ol')).toBe(true);
  await expect(row(reader)).toBeVisible();
  expect(await settledTop()).toBe(before);

  const html = await (await context.request.get(`/s/${token}`)).text();
  expect(html).toContain('aria-label="Filter the list"');
});

test('a priced, tagged share page hydrates without a mismatch', async ({
  page,
  browser,
  baseURL,
}) => {
  const { token, context } = await setUp(
    page,
    browser,
    baseURL ?? '',
    'filters-hydration',
    ADAS_LIST,
  );
  const reader = await context.newPage();
  const errors: string[] = [];
  reader.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  reader.on('pageerror', (error) => errors.push(error.message));
  await reader.goto(`/s/${token}`);
  await expect
    .poll(() => hydrated(reader, '[role="group"][aria-label="Filter the list"]'))
    .toBe(true);
  await reader.waitForLoadState('networkidle');
  // A production build reports a mismatch as an uncaught "Minified React error #418" or similar.
  expect(errors).toEqual([]);
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

test('Clear filters from the keyboard leaves focus on the row, not the page', async ({
  page,
  browser,
  baseURL,
}) => {
  // No prices, so no pill: the row starts with Books, which Kitchen's filter disables.
  const { gifter } = await setUp(page, browser, baseURL ?? '', 'filters-clear-focus', [
    tagged('Atlas', '', 'Books'),
    tagged('Field guide', '', 'Books'),
    tagged('Poetry', '', 'Books'),
    tagged('Whisk', '', 'Kitchen'),
    tagged('Ladle', '', 'Kitchen'),
  ]);
  await expect(row(gifter)).toBeVisible();
  await gifter.getByRole('heading', { level: 1 }).focus();
  await gifter.keyboard.press('Tab');
  await expect(chip(gifter, 'Books')).toBeFocused();
  await gifter.keyboard.press('Tab');
  await expect(chip(gifter, 'Kitchen')).toBeFocused();
  await gifter.keyboard.press('Space');
  await expect(row(gifter).getByRole('button', { name: 'Books, 0 items' })).toBeDisabled();
  await gifter.keyboard.press('Tab');
  await expect(gifter.getByRole('button', { name: 'Clear filters' })).toBeFocused();
  await gifter.keyboard.press('Enter');
  await expect(shownTitles(gifter)).toHaveCount(5);
  await expect(chip(gifter, 'Books')).toBeFocused();
});

test('the price menu closes on a click outside without taking focus, and on the pill with it (spec §7, the price pill)', async ({
  page,
  browser,
  baseURL,
}) => {
  const { gifter } = await setUp(page, browser, baseURL ?? '', 'filters-menu-close', ADAS_LIST);
  const menu = gifter.getByRole('group', { name: 'Price' });
  await pricePill(gifter).click();
  await expect(menu).toBeVisible();
  await chip(gifter, 'Books').click();
  await expect(menu).toBeHidden();
  await expect(chip(gifter, 'Books')).toBeFocused();
  await expect(chip(gifter, 'Books')).toHaveAttribute('aria-pressed', 'true');

  await pricePill(gifter).click();
  await expect(menu).toBeVisible();
  await pricePill(gifter).click();
  await expect(menu).toBeHidden();
  await expect(pricePill(gifter)).toBeFocused();
});

test('unticking a band a refresh has emptied keeps focus in the menu', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const { gifter } = await setUp(page, browser, base, 'filters-empty-band', ADAS_LIST);
  const menu = gifter.getByRole('group', { name: 'Price' });
  await pricePill(gifter).click();
  await menu.getByRole('checkbox', { name: '$100+, 1 item' }).check();
  await expect(gifter.getByText('1 of 7 items')).toBeVisible();

  // The knife, the only item over $100, goes; a refresh brings the list without it.
  const items = (await (await page.request.get('/api/wishlist')).json()) as {
    items: { id: string; title: string }[];
  };
  const knife = items.items.find((item) => item.title === 'Chef’s knife');
  const removed = await page.request.delete(`/api/wishlist/items/${knife?.id ?? ''}`, {
    headers: { origin: base },
    // The CSRF guard wants a JSON body on every state-changing request.
    data: {},
  });
  expect(removed.status()).toBe(204);
  await gifter.evaluate(() => {
    const w = globalThis as unknown as { next?: { router?: { refresh(): void } } };
    w.next?.router?.refresh();
  });
  await expect(gifter.locator('li').filter({ hasText: 'Chef’s knife' })).toHaveCount(0);
  await expect(gifter.getByText('Nothing on the list matches these filters.')).toBeVisible();

  const empty = menu.getByRole('checkbox', { name: '$100+, 0 items' });
  await empty.focus();
  await gifter.keyboard.press('Space');
  await expect(empty).not.toBeChecked();
  await expect(empty).toBeDisabled();
  await expect(menu.getByRole('button', { name: /^Any price,/ })).toBeFocused();
});
