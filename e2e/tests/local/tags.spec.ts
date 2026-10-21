import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import type { Tag } from '@wishlist/contracts';
import { expectAccessible } from '../../support/a11y.js';
import { addItemViaApi, verifiedOwner } from '../../support/owner.js';
import { guest, shareTokenOf } from '../../support/share.js';

const status = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });
/** A row's title button: its name starts with the title (the drag handle's and arrows' don't). */
const titleButton = (page: Page, title: string) =>
  page.getByRole('button', { name: new RegExp(`^${title}`) });
const tagBox = (page: Page) => page.getByRole('combobox', { name: 'Tags' });
const removeButtons = (page: Page) => page.getByRole('button', { name: /^Remove / });

async function createTagViaApi(request: APIRequestContext, base: string, name: string) {
  const res = await request.post('/api/wishlist/tags', {
    headers: { origin: base },
    data: { name },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as Tag;
}

/** The tag chips a gifter sees on the owner's share link. */
async function shareChips(page: Page, browser: Browser, base: string) {
  const token = await shareTokenOf(page.request);
  const context = await guest(browser, base);
  const gifter = await context.newPage();
  await gifter.goto(`/s/${token}`);
  const chips = gifter
    .getByRole('group', { name: 'Filter the list' })
    .getByRole('button', { name: /, \d+ items?$/ });
  return { context, chips };
}

test('tags a new item in the add form (design §4)', async ({ page, browser, baseURL }) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'tags-add');
  await page.goto('/list');
  await page.getByLabel('Add to your list').fill('https://hanker-e2e.invalid/kettle');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByLabel('Title').fill('Enamel kettle');
  await expect(page.getByText('Gifters can filter your list by these.')).toBeVisible();

  await tagBox(page).fill('Kitchen');
  await tagBox(page).press('Enter');
  await tagBox(page).fill('Christmas');
  await tagBox(page).press('Enter');
  // Enter added a tag each time; it didn't submit the form.
  await expect(page.getByRole('button', { name: 'Add to list' })).toBeVisible();
  await expect(tagBox(page)).toHaveValue('');
  await expect(removeButtons(page)).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Remove Christmas' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove Kitchen' })).toBeVisible();

  await page.getByRole('button', { name: 'Add to list' }).click();
  await expect(status(page, 'Added “Enamel kettle”.')).toBeVisible();

  const { context, chips } = await shareChips(page, browser, base);
  await expect(chips).toHaveText([/Christmas/, /Kitchen/]);
  await expect(chips.nth(0)).toHaveAccessibleName('Christmas, 1 item');
  await expect(chips.nth(1)).toHaveAccessibleName('Kitchen, 1 item');
  await context.close();
});

test('picks a suggestion with the keyboard and removes a tag in the edit form (RF4)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'tags-edit');
  await addItemViaApi(page.request, base, { title: 'Kettle', tags: [{ name: 'Christmas' }] });
  // An empty tag the owner made is still offered (Ledger ruling 6).
  await createTagViaApi(page.request, base, 'Kitchen');
  await page.goto('/list');
  await titleButton(page, 'Kettle').click();
  await expect(page.getByRole('button', { name: 'Remove Christmas' })).toBeVisible();

  await tagBox(page).fill('kit');
  const suggestions = page.getByRole('listbox', { name: 'Tag suggestions' });
  await expect(suggestions.getByRole('option')).toHaveText(['Kitchen']);
  await expect(tagBox(page)).toHaveAttribute('aria-expanded', 'true');
  await tagBox(page).press('ArrowDown');
  const option = suggestions.getByRole('option', { name: 'Kitchen' });
  await expect(option).toHaveAttribute('aria-selected', 'true');
  await expect(tagBox(page)).toHaveAttribute(
    'aria-activedescendant',
    (await option.getAttribute('id')) ?? '',
  );
  await expectAccessible(page);
  await tagBox(page).press('Enter');
  await expect(suggestions).toBeHidden();
  await expect(tagBox(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: 'Remove Kitchen' })).toBeVisible();

  // Typing a tag it already has adds nothing.
  await tagBox(page).fill('KITCHEN');
  await tagBox(page).press('Enter');
  await expect(removeButtons(page)).toHaveCount(2);

  // Backspace in the empty box goes to the last chip's remove button, and removes nothing.
  await tagBox(page).press('Backspace');
  await expect(page.getByRole('button', { name: 'Remove Kitchen' })).toBeFocused();
  await expect(removeButtons(page)).toHaveCount(2);

  await page.getByRole('button', { name: 'Remove Christmas' }).click();
  await expect(removeButtons(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(status(page, 'Saved “Kettle”.')).toBeVisible();

  const { context, chips } = await shareChips(page, browser, base);
  await expect(chips).toHaveText([/Kitchen/]);
  await expect(chips.first()).toHaveAccessibleName('Kitchen, 1 item');
  await context.close();
});

test('refuses an 11th tag in the field, and Escape closes the suggestions (ruling 7)', async ({
  page,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'tags-eleven');
  await addItemViaApi(page.request, base, {
    title: 'Kettle',
    tags: Array.from({ length: 10 }, (_, i) => ({ name: `Tag ${String(i)}` })),
  });
  await page.goto('/list');
  await titleButton(page, 'Kettle').click();
  await expect(removeButtons(page)).toHaveCount(10);

  await tagBox(page).fill('Tag');
  await expect(page.getByRole('listbox', { name: 'Tag suggestions' })).toHaveCount(0);
  await tagBox(page).fill('Eleventh');
  await tagBox(page).press('Enter');
  await expect(page.getByText('An item can have at most 10 tags.')).toBeVisible();
  await expect(tagBox(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(removeButtons(page)).toHaveCount(10);
  await expect(tagBox(page)).toHaveValue('Eleventh');

  // Removing one makes room.
  await page.getByRole('button', { name: 'Remove Tag 9' }).click();
  await tagBox(page).fill('Eleventh');
  await expect(page.getByText('An item can have at most 10 tags.')).toBeHidden();
  await tagBox(page).press('Enter');
  await expect(page.getByRole('button', { name: 'Remove Eleventh' })).toBeVisible();

  await tagBox(page).fill('Tag 9');
  const suggestions = page.getByRole('listbox', { name: 'Tag suggestions' });
  await expect(suggestions.getByRole('option')).toHaveText(['Tag 9']);
  await tagBox(page).press('Escape');
  await expect(suggestions).toBeHidden();
  await expect(tagBox(page)).toHaveValue('Tag 9');
});

test('a tick made while the form is open survives saving it (RF3)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'tags-rf3');
  await addItemViaApi(page.request, base, { title: 'Socks' });
  const kettle = await addItemViaApi(page.request, base, { title: 'Kettle' });
  const kitchen = await createTagViaApi(page.request, base, 'Kitchen');
  await page.goto('/list');
  await titleButton(page, 'Kettle').click();

  // Ticked elsewhere (the Tags sheet, another device) while this form is open.
  const tick = await page.request.put(`/api/wishlist/tags/${kitchen.id}/items/${kettle.id}`, {
    headers: { origin: base },
    data: {},
  });
  expect(tick.status()).toBe(204);

  await page.getByLabel('Title').fill('Stovetop kettle');
  const patch = page.waitForRequest(
    (request) => request.method() === 'PATCH' && request.url().endsWith(`/items/${kettle.id}`),
  );
  await page.getByRole('button', { name: 'Save' }).click();
  const body = (await patch).postDataJSON() as Record<string, unknown>;
  expect(body).toMatchObject({ title: 'Stovetop kettle' });
  expect(Object.keys(body)).not.toContain('tags');
  await expect(status(page, 'Saved “Stovetop kettle”.')).toBeVisible();

  const { context, chips } = await shareChips(page, browser, base);
  await expect(chips).toHaveText([/Kitchen/]);
  await expect(chips.first()).toHaveAccessibleName('Kitchen, 1 item');
  await context.close();
});
