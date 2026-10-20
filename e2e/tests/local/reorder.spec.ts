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
  const handle = page.getByRole('button', { name: 'Drag “C” to reorder' });
  // The handle takes keys as soon as hydration commits, but dnd-kit's Accessibility subscribes to
  // drag events in a useEffect. A Space in between starts the drag and loses "Picked up" for good.
  // The handle's instructions appear only after that effect has run, so once they exist, the
  // announcement has a listener.
  await expect(
    page.locator(`[id="${await handle.getAttribute('aria-describedby')}"]`),
  ).toBeAttached();
  await handle.focus();
  await page.keyboard.press('Space');
  await expect(status(page, 'Picked up “C”, position 3 of 3.')).toBeVisible();
  // The announcement comes from a render and doesn't mean the sensor can take a key yet: dnd-kit's
  // KeyboardSensor attaches its keydown listener in a setTimeout(0) after activation, and a key
  // that arrives first is dropped. A timeout queued now runs after that one (same delay, queued
  // later), so waiting for it waits for the listener.
  await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve)));
  // Each later step is ready once the previous one has been announced and rendered.
  await page.keyboard.press('ArrowUp');
  await expect(status(page, '“C” is over position 2 of 3.')).toBeVisible();
  await page.keyboard.press('ArrowUp');
  await expect(status(page, '“C” is over position 1 of 3.')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(status(page, 'Dropped “C” at position 1 of 3.')).toBeVisible();
  await expect.poll(() => savedOrder(page)).toEqual(['C', 'A', 'B']);
});

test('moves an item with the pointer, by its drag handle, without stretching the row', async ({
  page,
  baseURL,
}) => {
  // Tall enough to see every row at once: the mouse can't drag to a point outside the viewport.
  await page.setViewportSize({ width: 1280, height: 1000 });
  await ownerWith(page, baseURL ?? '', 'pointer', ['A', 'B', 'C']);
  const handle = await page.getByRole('button', { name: 'Drag “C” to reorder' }).boundingBox();
  const target = await page.getByRole('listitem').first().boundingBox();
  if (!handle || !target) throw new Error('the rows are not laid out');
  const row = page.getByRole('listitem').filter({ hasText: 'C' });
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  // Drift sideways as well: the row must follow the pointer's height only, and never be scaled.
  await page.mouse.move(handle.x + 120, handle.y - 20, { steps: 5 });
  await page.mouse.move(handle.x + 120, target.y + 10, { steps: 10 });
  await expect(row).toHaveCSS('transform', /^matrix\(1, 0, 0, 1, 0, -?\d/);
  await page.mouse.up();
  await expect.poll(() => savedOrder(page)).toEqual(['C', 'A', 'B']);
});

test('the drag handles point at instructions that exist, on every load', async ({
  page,
  baseURL,
}) => {
  await ownerWith(page, baseURL ?? '', 'describedby', ['A', 'B']);
  // dnd-kit numbers these ids with a counter that grows on each server render, so a second load
  // gets different ids than the first unless the DndContext has its own.
  await page.reload();
  const handle = page.getByRole('button', { name: 'Drag “A” to reorder' });
  const id = await handle.getAttribute('aria-describedby');
  expect(id).toBeTruthy();
  await expect(page.locator(`[id="${id}"]`)).toContainText('To move an item, press Space.');
});

test('an item moved to the top by its up arrow keeps focus on its down arrow', async ({
  page,
  baseURL,
}) => {
  await ownerWith(page, baseURL ?? '', 'to-top', ['A', 'B', 'C']);
  await arrow(page, 'B', 'up').click();
  await expect(arrow(page, 'B', 'up')).toBeDisabled();
  await expect(arrow(page, 'B', 'down')).toBeFocused();
  await expect.poll(() => savedOrder(page)).toEqual(['B', 'A', 'C']);
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
  // The add reaches the server at once and only its answer is held. A move that didn't wait for
  // the add would send an order without C, and the server would answer 409.
  await page.route('**/api/wishlist/items', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    await new Promise((r) => setTimeout(r, 1500));
    await route.fulfill({ response });
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
  // Every row says "An idea", so look for the title itself, in the first row.
  await expect(
    page.getByRole('listitem').first().getByRole('button', { name: 'A An idea', exact: true }),
  ).toBeVisible();
});
