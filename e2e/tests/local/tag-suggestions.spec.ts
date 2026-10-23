import { expect, test, type Page, type Route } from '@playwright/test';
import type { ItemTagRef, TagSuggestionsRequest, WishlistResponse } from '@wishlist/contracts';
import { expectAccessible } from '../../support/a11y.js';
import { addItemViaApi, verifiedOwner } from '../../support/owner.js';

const status = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });
const titleButton = (page: Page, title: string) =>
  page.getByRole('button', { name: new RegExp(`^${title}`) });
const tagBox = (page: Page) => page.getByRole('combobox', { name: 'Tags' });
const suggested = (page: Page) => page.getByRole('group', { name: 'Suggested tags' });
const URL_PASTED = 'https://hanker-e2e.invalid/kettle';

/**
 * Stubs the suggestions route and records each request body. `answer` is what the stub says; a
 * number answers that HTTP status with a problem body instead.
 */
async function stubSuggestions(page: Page, answer: ItemTagRef[] | number) {
  const requests: TagSuggestionsRequest[] = [];
  await page.route('**/api/wishlist/tag-suggestions', async (route: Route) => {
    requests.push(route.request().postDataJSON() as TagSuggestionsRequest);
    if (typeof answer === 'number') {
      await route.fulfill({
        status: answer,
        contentType: 'application/problem+json',
        body: JSON.stringify({ title: 'Server error', status: answer, code: 'INTERNAL' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ suggestions: answer }),
    });
  });
  return requests;
}

async function stubUnfurl(page: Page, body: Record<string, string>) {
  await page.route('**/api/wishlist/unfurl', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }),
  );
}

async function addThroughTheBox(page: Page, text: string) {
  await page.getByLabel('Add to your list').fill(text);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
}

/** The owner's list as the API has it, with each item's tag names. */
async function savedTags(page: Page): Promise<Record<string, string[]>> {
  const list = (await (await page.request.get('/api/wishlist')).json()) as WishlistResponse;
  const names = new Map((list.tags ?? []).map((tag) => [tag.id, tag.name]));
  return Object.fromEntries(
    list.items.map((item) => [
      item.title,
      (item.tagIds ?? []).map((id) => names.get(id) ?? id).sort(),
    ]),
  );
}

/** An owner whose list already holds a `Kitchen` tag, on another item. */
async function ownerWithKitchen(page: Page, base: string, label: string): Promise<string> {
  await verifiedOwner(page, base, label);
  const existing = await addItemViaApi(page.request, base, {
    title: 'Existing',
    tags: [{ name: 'Kitchen' }],
  });
  const kitchenId = existing.tagIds?.[0];
  if (!kitchenId) throw new Error('the Kitchen tag was not made');
  return kitchenId;
}

test('suggests tags for a link, and adds the ones tapped (design §5.1)', async ({
  page,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const kitchenId = await ownerWithKitchen(page, base, 'suggest-add');
  await stubUnfurl(page, { title: 'Stagg EKG kettle', description: 'Electric pour-over kettle.' });
  const requests = await stubSuggestions(page, [{ id: kitchenId }, { name: 'Coffee' }]);
  await page.goto('/list');
  await addThroughTheBox(page, URL_PASTED);

  const row = suggested(page);
  await expect(row).toBeVisible();
  await expect(row).toContainText('Suggested:');
  const kitchen = row.getByRole('button', { name: 'Add tag Kitchen' });
  const coffee = row.getByRole('button', { name: 'Add new tag Coffee' });
  await expect(row.getByRole('button')).toHaveCount(2);
  await expect(kitchen).toContainText('+ Kitchen');
  await expect(coffee).toContainText('+ Coffee');
  // The marker sits beside the button, not in it (label in name), so look at the row.
  await expect(row.getByText('new', { exact: true })).toHaveCount(1);
  expect(requests).toEqual([
    { title: 'Stagg EKG kettle', url: URL_PASTED, description: 'Electric pour-over kettle.' },
  ]);
  await expectAccessible(page);

  // A new tag first: it joins the tag box, leaves the row, and focus moves to the next chip.
  await coffee.click();
  await expect(page.getByRole('button', { name: 'Remove Coffee' })).toBeVisible();
  await expect(coffee).toHaveCount(0);
  await expect(kitchen).toBeFocused();
  // The last chip: the row goes, and focus is in the tag input.
  await kitchen.click();
  await expect(page.getByRole('button', { name: 'Remove Kitchen' })).toBeVisible();
  await expect(suggested(page)).toHaveCount(0);
  await expect(tagBox(page)).toBeFocused();

  await page.getByRole('button', { name: 'Add to list' }).click();
  await expect(status(page, 'Added “Stagg EKG kettle”.')).toBeVisible();
  expect((await savedTags(page))['Stagg EKG kettle']).toEqual(['Coffee', 'Kitchen']);
  // Tapping asked for nothing more.
  expect(requests).toHaveLength(1);
});

test('suggestions left untapped are dropped when the item is saved', async ({ page, baseURL }) => {
  const base = baseURL ?? '';
  const kitchenId = await ownerWithKitchen(page, base, 'suggest-untapped');
  await stubUnfurl(page, { title: 'Pour-over kettle' });
  await stubSuggestions(page, [{ id: kitchenId }, { name: 'Coffee' }]);
  await page.goto('/list');
  await addThroughTheBox(page, URL_PASTED);
  await expect(suggested(page)).toBeVisible();
  await page.getByRole('button', { name: 'Add to list' }).click();
  await expect(status(page, 'Added “Pour-over kettle”.')).toBeVisible();
  expect((await savedTags(page))['Pour-over kettle']).toEqual([]);
});

test('asks for an idea’s tags when the form opens, and again when its title changes', async ({
  page,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const kitchenId = await ownerWithKitchen(page, base, 'suggest-idea');
  const requests = await stubSuggestions(page, [{ id: kitchenId }]);
  await page.goto('/list');
  await addThroughTheBox(page, 'Pottery class for two');
  await expect(suggested(page).getByRole('button', { name: 'Add tag Kitchen' })).toBeVisible();
  expect(requests).toEqual([{ title: 'Pottery class for two' }]);

  // Leaving the title unchanged asks nothing; a changed title asks again.
  const title = page.getByLabel('Title', { exact: true });
  await title.focus();
  await title.blur();
  await title.fill('Pottery class for four');
  await page.getByLabel('Note').focus();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toEqual({ title: 'Pottery class for four' });
});

test('hides the row while the title is blank', async ({ page, baseURL }) => {
  const base = baseURL ?? '';
  const kitchenId = await ownerWithKitchen(page, base, 'suggest-blank');
  await stubSuggestions(page, [{ id: kitchenId }]);
  await page.goto('/list');
  await addThroughTheBox(page, 'Pottery class');
  await expect(suggested(page)).toBeVisible();
  await page.getByLabel('Title', { exact: true }).fill('');
  await expect(suggested(page)).toHaveCount(0);
});

test('asks once when an item’s edit form opens, and doesn’t offer its own tags', async ({
  page,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const kitchenId = await ownerWithKitchen(page, base, 'suggest-edit');
  await addItemViaApi(page.request, base, { title: 'Kettle', tags: [{ id: kitchenId }] });
  const requests = await stubSuggestions(page, [{ id: kitchenId }, { name: 'Coffee' }]);
  await page.goto('/list');
  await titleButton(page, 'Kettle').click();
  const row = suggested(page);
  await expect(row.getByRole('button')).toHaveCount(1);
  await expect(row.getByRole('button', { name: 'Add new tag Coffee' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Add tag Kitchen' })).toHaveCount(0);
  expect(requests).toEqual([{ title: 'Kettle', tagIds: [kitchenId] }]);

  // A tap marks the tags changed, so the save sends them.
  await row.getByRole('button', { name: 'Add new tag Coffee' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(status(page, 'Saved “Kettle”.')).toBeVisible();
  expect((await savedTags(page))['Kettle']).toEqual(['Coffee', 'Kitchen']);
});

test('asks for nothing, and shows no row, when suggestions are off', async ({ page, baseURL }) => {
  const base = baseURL ?? '';
  const kitchenId = await ownerWithKitchen(page, base, 'suggest-off');
  const requests = await stubSuggestions(page, [{ id: kitchenId }]);
  await page.goto('/settings');
  const toggle = page.getByRole('switch', { name: 'Suggest tags' });
  await toggle.click();
  await expect(status(page, 'Tag suggestions are off.')).toBeVisible();

  await page.goto('/list');
  await addThroughTheBox(page, 'Pottery class');
  await expect(page.getByRole('form', { name: 'New item' })).toBeVisible();
  await page.getByLabel('Title', { exact: true }).fill('Pottery class for four');
  await page.getByLabel('Note').focus();
  await page.waitForTimeout(500);
  expect(requests).toHaveLength(0);
  await expect(suggested(page)).toHaveCount(0);
});

test('a failed request shows nothing, and the item still saves', async ({ page, baseURL }) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'suggest-fail');
  const requests = await stubSuggestions(page, 500);
  await page.goto('/list');
  await addThroughTheBox(page, 'Pottery class');
  await expect.poll(() => requests.length).toBe(1);
  await expect(page.getByRole('form', { name: 'New item' })).toBeVisible();
  await page.waitForTimeout(300);
  await expect(suggested(page)).toHaveCount(0);
  // Next's route announcer is an empty alert; a message would have text.
  await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add to list' }).click();
  await expect(status(page, 'Added “Pottery class”.')).toBeVisible();
  expect((await savedTags(page))['Pottery class']).toEqual([]);
});
