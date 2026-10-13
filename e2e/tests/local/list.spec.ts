import { expect, test, type Page } from '@playwright/test';
import { expectAccessible, expectFitsPhone, expectNoSidewaysScroll } from '../../support/a11y.js';
import { addItemViaApi, verifiedOwner } from '../../support/owner.js';

const rowsOf = (page: Page) =>
  page.getByRole('list', { name: 'Your items, most wanted first' }).getByRole('listitem');

test('a new owner sees an empty list, with nothing to share yet', async ({ page, baseURL }) => {
  await verifiedOwner(page, baseURL ?? '', 'empty');
  await page.goto('/list');
  await expect(page.getByRole('heading', { level: 1, name: "Ada's wishlist" })).toBeVisible();
  await expect(page.getByText('Nothing here yet')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy share link' })).toHaveCount(0);
  await expectAccessible(page);
});

test('shows the list in order, with prices, quantities, shops and ideas', async ({
  page,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'rows');
  await addItemViaApi(page.request, base, {
    title: 'Enamel stovetop kettle',
    url: 'https://www.hearthware.example/kettle',
    priceText: '$48.00',
  });
  await addItemViaApi(page.request, base, {
    title: 'Merino hiking socks',
    url: 'https://trailpost.example/socks',
    priceText: '$24.00',
    quantity: 3,
  });
  await addItemViaApi(page.request, base, {
    title: 'Pottery class for two',
    note: 'Any studio near Elm Street',
  });
  await page.goto('/list');
  const rows = rowsOf(page);
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Enamel stovetop kettle');
  await expect(rows.nth(0)).toContainText('$48.00');
  await expect(rows.nth(0)).toContainText('hearthware.example');
  await expect(rows.nth(1)).toContainText('3 wanted');
  await expect(rows.nth(2)).toContainText('An idea: Any studio near Elm Street');
  await expectAccessible(page);
});

test('copies the share link', async ({ page, baseURL, context }) => {
  const base = baseURL ?? '';
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await verifiedOwner(page, base, 'copy');
  await addItemViaApi(page.request, base, { title: 'Kettle' });
  await page.goto('/list');
  await page.getByRole('button', { name: 'Copy share link' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Link copied.' })).toBeVisible();
  const { shareUrl } = (await (await page.request.get('/api/wishlist')).json()) as {
    shareUrl: string;
  };
  // e2e has no DOM lib, so the page's globals are typed by hand.
  const copied = await page.evaluate(() =>
    (
      globalThis as unknown as { navigator: { clipboard: { readText(): Promise<string> } } }
    ).navigator.clipboard.readText(),
  );
  expect(copied).toBe(shareUrl);
});

test('a photo that won’t load shows the placeholder tile (Review Focus 3)', async ({
  page,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'photo');
  await addItemViaApi(page.request, base, {
    title: 'Kettle',
    url: 'https://hanker-e2e.invalid/kettle',
    imageUrl: 'https://hanker-e2e.invalid/kettle.jpg',
  });
  await page.goto('/list');
  await expect(rowsOf(page).first()).toContainText('Kettle');
  await expect(rowsOf(page).first().locator('img')).toHaveCount(0);
});

// One test, so one owner: the suite signs up as many people as the API's per-IP mail limit allows
// in an hour (20), and every sign-up counts against it.
test('long unbroken text wraps on a phone: a title, and the link in a copy-failed notice (Review Focus 5)', async ({
  page,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'long');
  await addItemViaApi(page.request, base, { title: 'K'.repeat(200), note: 'N'.repeat(400) });

  // A real share link breaks after its slashes, so make the page hold one that can't break anywhere.
  const longUrl = `https://hanker.example/${'k'.repeat(120)}`;
  await page.route('**/api/wishlist', async (route) => {
    const real = (await (await route.fetch()).json()) as object;
    await route.fulfill({ json: { ...real, shareUrl: longUrl } });
  });
  // e2e has no DOM lib, so the page's globals are typed by hand.
  await page.addInitScript(() => {
    const { navigator } = globalThis as unknown as {
      navigator: { clipboard: { writeText(text: string): Promise<void> } };
    };
    navigator.clipboard.writeText = () => Promise.reject(new Error('blocked'));
  });

  await expectFitsPhone(page, '/list');

  const status = page.getByRole('status').filter({ hasText: 'Copy this link:' });
  // Coming back to the tab refetches the list, which then carries the long link. Retried as a
  // whole, since the page may not have hydrated (so isn't listening) the first time.
  await expect(async () => {
    await page.evaluate(() => {
      const { document, Event } = globalThis as unknown as {
        document: { dispatchEvent(event: unknown): void };
        Event: new (type: string, init: { bubbles: boolean }) => unknown;
      };
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    });
    await page.getByRole('button', { name: 'Copy share link' }).click();
    await expect(status).toContainText(longUrl, { timeout: 500 });
  }).toPass();
  await expectNoSidewaysScroll(page);
});
