import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { addItemViaApi, verifiedOwner } from '../support/owner.js';
import { claimViaApi, shareTokenOf } from '../support/share.js';

/**
 * The README's four screenshots (docs/images). Not part of CI: run with
 * `scripts/e2e.sh --config playwright.screenshots.config.ts`. The list is made up. Nothing here
 * calls Cloudflare, a shop or Etsy: the suggestions and the link preview are stubbed.
 *
 * `editor.png` comes from the `desktop` project, the others from `phone`.
 */
const IMAGES = new URL('../../docs/images/', import.meta.url);
const imagePath = (name: string) => fileURLToPath(new URL(name, IMAGES));
const SHOP = 'https://shop.example';

/** Ada's list: the items, notes and prices the README has always shown, now with tags. */
async function seedList(page: Page, base: string) {
  await verifiedOwner(page, base, 'readme');
  const renamed = await page.request.patch('/api/wishlist', {
    headers: { origin: base },
    data: { title: "Ada's birthday wishlist" },
  });
  expect(renamed.status()).toBe(200);
  const add = (item: Parameters<typeof addItemViaApi>[2]) =>
    addItemViaApi(page.request, base, item);
  const kettle = await add({
    title: 'Stovetop kettle',
    url: `${SHOP}/kettle`,
    priceText: '$40',
    note: 'The matte black one, not the steel.',
    tags: [{ name: 'Kitchen' }],
  });
  await add({
    title: 'Linen apron',
    url: `${SHOP}/apron`,
    priceText: '$28',
    tags: [{ name: 'Kitchen' }],
  });
  await add({
    title: 'Seed-starting kit',
    url: `${SHOP}/seeds`,
    priceText: '$22',
    note: 'Any size is fine.',
    tags: [{ name: 'Garden' }],
  });
  await add({
    title: 'Wool socks',
    url: `${SHOP}/socks`,
    priceText: '$18',
    quantity: 3,
    tags: [{ name: 'Clothes' }],
  });
  await add({
    title: 'A day at the pottery studio',
    note: 'I would love to try the wheel.',
    tags: [{ name: 'Experiences' }],
  });
  return { kettle, token: await shareTokenOf(page.request) };
}

/** A gifter's browser: no session, and the same size and pixel density as the project's phone. */
async function gifterPage(page: Page, info: TestInfo, base: string): Promise<Page> {
  const { viewport, deviceScaleFactor, isMobile, hasTouch } = info.project.use;
  const context = await page
    .context()
    .browser()
    ?.newContext({
      baseURL: base,
      ...(viewport ? { viewport } : {}),
      ...(deviceScaleFactor ? { deviceScaleFactor } : {}),
      ...(isMobile ? { isMobile } : {}),
      ...(hasTouch ? { hasTouch } : {}),
    });
  if (!context) throw new Error('no browser to open a gifter in');
  return context.newPage();
}

test.describe('desktop', () => {
  test('editor.png: the owner’s list', async ({ page, baseURL }, info) => {
    test.skip(info.project.name !== 'desktop', 'editor.png is a desktop picture');
    await seedList(page, baseURL ?? '');
    await page.goto('/list');
    await expect(page.getByRole('heading', { name: "Ada's birthday wishlist" })).toBeVisible();
    await expect(page.getByText('A day at the pottery studio')).toBeVisible();
    await page.screenshot({ path: imagePath('editor.png') });
  });
});

test.describe('phone', () => {
  test('share.png: a shared list with one item taken', async ({ page, baseURL }, info) => {
    test.skip(info.project.name !== 'phone', 'a phone picture');
    const base = baseURL ?? '';
    const { kettle, token } = await seedList(page, base);
    const gifter = await gifterPage(page, info, base);
    await claimViaApi(gifter.request, base, token, kettle.id, { claimerName: 'Aunt Sue' });
    await gifter.goto(`/s/${token}`);
    await expect(gifter.getByText('Aunt Sue is getting this')).toBeVisible();
    await gifter.screenshot({ path: imagePath('share.png') });
    await gifter.context().close();
  });

  test('claim.png: the claim sheet', async ({ page, baseURL }, info) => {
    test.skip(info.project.name !== 'phone', 'a phone picture');
    const base = baseURL ?? '';
    const { kettle, token } = await seedList(page, base);
    const gifter = await gifterPage(page, info, base);
    await claimViaApi(gifter.request, base, token, kettle.id, { claimerName: 'Aunt Sue' });
    await gifter.goto(`/s/${token}`);
    // Only the apron has its button on screen first; the kettle is already taken.
    await gifter.getByRole('button', { name: 'I’ll get this' }).first().click();
    const sheet = gifter.getByRole('dialog', { name: 'Linen apron' });
    await expect(sheet).toBeVisible();
    await sheet.getByLabel('Your name').fill('Ben');
    // The sheet rises into place; wait for it to settle before the picture.
    await gifter.waitForTimeout(600);
    await gifter.screenshot({ path: imagePath('claim.png') });
    await gifter.context().close();
  });

  test('suggestions.png: the add form with suggested tags', async ({ page, baseURL }, info) => {
    test.skip(info.project.name !== 'phone', 'a phone picture');
    const base = baseURL ?? '';
    const { kettle } = await seedList(page, base);
    const kitchenId = kettle.tagIds?.[0];
    if (!kitchenId) throw new Error('the Kitchen tag was not made');
    // The shop and Cloudflare are stubbed: a made-up preview, and the answer the route would give.
    await page.route('**/api/wishlist/unfurl', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          title: 'Pour-over kettle',
          priceText: '$55',
          description: 'A gooseneck kettle for pour-over coffee.',
        }),
      }),
    );
    await page.route('**/api/wishlist/tag-suggestions', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ suggestions: [{ id: kitchenId }, { name: 'Coffee' }] }),
      }),
    );
    await page.goto('/list');
    await page.getByLabel('Add to your list').fill(`${SHOP}/pour-over-kettle`);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const row = page.getByRole('group', { name: 'Suggested tags' });
    await expect(row).toBeVisible();
    await expect(row.getByRole('button', { name: 'Add new tag Coffee' })).toBeVisible();
    // The whole form, so the title and price show above the Tags field and its row.
    await page.waitForTimeout(300);
    const form = page
      .locator('form')
      .filter({ has: page.getByRole('button', { name: 'Add to list' }) });
    const box = await form.boundingBox();
    if (!box) throw new Error('the add form has no box');
    const scrollY = await page.evaluate(
      () => (globalThis as unknown as { scrollY: number }).scrollY,
    );
    // A margin all round, so the focus ring on the title isn't cut off.
    const margin = 16;
    await page.screenshot({
      path: imagePath('suggestions.png'),
      fullPage: true,
      clip: {
        x: Math.max(0, box.x - margin),
        y: Math.max(0, box.y + scrollY - margin),
        width: box.width + 2 * margin,
        height: box.height + 2 * margin,
      },
    });
  });
});
