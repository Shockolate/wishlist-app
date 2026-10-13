import { expect, test, type Page } from '@playwright/test';
import { addItemViaApi, verifiedOwner } from '../../support/owner.js';

const status = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

/** The titles in the API's order: what a reload would show. */
async function savedOrder(page: Page): Promise<string[]> {
  const { items } = (await (await page.request.get('/api/wishlist')).json()) as {
    items: { title: string }[];
  };
  return items.map((item) => item.title);
}

async function ownerWith(page: Page, baseURL: string, label: string, titles: string[]) {
  await verifiedOwner(page, baseURL, label);
  for (const title of titles) await addItemViaApi(page.request, baseURL, { title });
  await page.goto('/list');
}

const arrow = (page: Page, title: string, way: 'up' | 'down') =>
  page.getByRole('button', { name: `Move “${title}” ${way}` });

test('moves an item with the arrows, keeping focus, and the order is saved', async ({
  page,
  baseURL,
}) => {
  await ownerWith(page, baseURL ?? '', 'arrows', ['A', 'B', 'C']);
  await arrow(page, 'A', 'down').click();
  await expect(status(page, 'Moved “A” to position 2 of 3.')).toBeVisible();
  await expect(arrow(page, 'A', 'down')).toBeFocused();
  await arrow(page, 'A', 'down').click();
  // At the bottom, "down" is disabled, so focus moves to "up".
  await expect(arrow(page, 'A', 'down')).toBeDisabled();
  await expect(arrow(page, 'A', 'up')).toBeFocused();
  await expect.poll(() => savedOrder(page)).toEqual(['B', 'C', 'A']);
  await page.reload();
  await expect(page.getByRole('listitem').first()).toContainText('B');
});

test('moves an item with the keyboard, by its drag handle', async ({ page, baseURL }) => {
  await ownerWith(page, baseURL ?? '', 'keyboard', ['A', 'B', 'C']);
  await page.getByRole('button', { name: 'Drag “C” to reorder' }).focus();
  await page.keyboard.press('Space');
  // dnd-kit announces "picked up", then at once where it is. It measures the rows before it can
  // take a key, and a key pressed earlier is dropped, so each step waits for its announcement.
  await expect(status(page, '“C” is over position 3 of 3.')).toBeVisible();
  await page.keyboard.press('ArrowUp');
  await expect(status(page, '“C” is over position 2 of 3.')).toBeVisible();
  await page.keyboard.press('ArrowUp');
  await expect(status(page, '“C” is over position 1 of 3.')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(status(page, 'Dropped “C” at position 1 of 3.')).toBeVisible();
  await expect.poll(() => savedOrder(page)).toEqual(['C', 'A', 'B']);
});

test('several quick moves all land, in order (Review Focus 2)', async ({ page, baseURL }) => {
  await ownerWith(page, baseURL ?? '', 'quick', ['A', 'B', 'C', 'D']);
  for (let n = 0; n < 3; n++) await arrow(page, 'A', 'down').click();
  await expect.poll(() => savedOrder(page)).toEqual(['B', 'C', 'D', 'A']);
  await expect(page.getByRole('alert').filter({ hasText: 'reloaded' })).toHaveCount(0);
});

test('a move made while an add is still on its way includes the new item (Review Focus 2)', async ({
  page,
  baseURL,
}) => {
  await ownerWith(page, baseURL ?? '', 'in-flight', ['A', 'B']);
  // Hold the add, so the move is queued behind it.
  await page.route('**/api/wishlist/items', async (route) => {
    if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.getByLabel('Add to your list').fill('C');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await arrow(page, 'B', 'up').click();
  await expect(status(page, 'Added “C”.')).toBeVisible();
  await expect.poll(() => savedOrder(page)).toEqual(['B', 'A', 'C']);
  await expect(page.getByRole('alert').filter({ hasText: 'reloaded' })).toHaveCount(0);
});

test('a stale order reloads the list and says why', async ({ page, baseURL }) => {
  const base = baseURL ?? '';
  await ownerWith(page, base, 'stale', ['A', 'B']);
  await page.route(
    '**/api/wishlist/items/order',
    (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Conflict',
          status: 409,
          code: 'ORDER_CONFLICT',
          requestId: 'e2e',
        }),
      }),
    { times: 1 },
  );
  await arrow(page, 'B', 'up').click();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Your list changed on another device, so we’ve reloaded it.' }),
  ).toBeVisible();
  await expect(page.getByRole('listitem').first()).toContainText('A');
});
