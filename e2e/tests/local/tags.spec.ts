import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import type { Tag, WishlistResponse } from '@wishlist/contracts';
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
  return { context, chips, gifter };
}

/** The Tags sheet: one dialog, whichever pane it shows. */
const tagsSheet = (page: Page) => page.getByRole('dialog');
const tagsButton = (page: Page) => page.getByRole('button', { name: 'Tags', exact: true });
/** A tag's row in the sheet's all-tags pane, or every row. */
const tagRow = (page: Page, name?: string) =>
  tagsSheet(page).getByRole('button', {
    name: name === undefined ? /, \d+ items?$/ : new RegExp(`^${name}, \\d+ items?$`),
  });

/**
 * Starts recording each heading that takes focus, with its text at that moment, and returns a
 * function that hands over (and clears) what was recorded. A heading focused before its new name
 * renders would show up here with the old one, which `toBeFocused` can't see.
 */
async function recordHeadingFocus(page: Page): Promise<() => Promise<string[]>> {
  // e2e has no DOM lib, so the page's globals are typed by hand.
  await page.evaluate(() => {
    const scope = globalThis as unknown as {
      headingFocus: string[];
      document: {
        addEventListener: (
          type: 'focusin',
          listener: (event: { target: { tagName: string; textContent: string } }) => void,
        ) => void;
      };
    };
    scope.headingFocus = [];
    scope.document.addEventListener('focusin', ({ target }) => {
      if (/^H[1-6]$/.test(target.tagName)) scope.headingFocus.push(target.textContent);
    });
  });
  return () =>
    page.evaluate(() =>
      (globalThis as unknown as { headingFocus: string[] }).headingFocus.splice(0),
    );
}

/** How many items carry each tag, as the API has it: what's saved, not what the page shows. */
async function savedTagCounts(request: APIRequestContext): Promise<Record<string, number>> {
  const list = (await (await request.get('/api/wishlist')).json()) as WishlistResponse;
  return Object.fromEntries(
    (list.tags ?? []).map((tag) => [
      tag.name,
      list.items.filter((item) => item.tagIds?.includes(tag.id)).length,
    ]),
  );
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
  // An empty tag the owner made is still offered (spec §7, the tag field).
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

test('refuses an 11th tag in the field, and Escape closes the suggestions (Plan 7b ruling 7)', async ({
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
  // It already carries a tag, so the untouched field isn't empty.
  const kettle = await addItemViaApi(page.request, base, {
    title: 'Kettle',
    tags: [{ name: 'Christmas' }],
  });
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
  await expect(chips).toHaveText([/Christmas/, /Kitchen/]);
  await expect(chips.nth(1)).toHaveAccessibleName('Kitchen, 1 item');
  await context.close();
});

test('a tag typed without Enter is added when the item is saved, unless it’s refused', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'tags-typed');
  const kettle = await addItemViaApi(page.request, base, { title: 'Kettle' });
  let patches = 0;
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && request.url().endsWith(`/items/${kettle.id}`)) patches++;
  });
  await page.goto('/list');
  await titleButton(page, 'Kettle').click();

  // A name the field refuses holds the save back, with the reason on the field.
  await tagBox(page).fill('x'.repeat(31));
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Use 30 characters or fewer.')).toBeVisible();
  await expect(tagBox(page)).toBeFocused();
  await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
  expect(patches).toBe(0);

  await tagBox(page).fill('Kitchen');
  const patch = page.waitForRequest(
    (request) => request.method() === 'PATCH' && request.url().endsWith(`/items/${kettle.id}`),
  );
  await page.getByRole('button', { name: 'Save' }).click();
  // Adding it changed the field, so the edit form sends the tags (Plan 7b ruling 5).
  expect((await patch).postDataJSON()).toMatchObject({ tags: [{ name: 'Kitchen' }] });
  await expect(status(page, 'Saved “Kettle”.')).toBeVisible();

  const { context, chips } = await shareChips(page, browser, base);
  await expect(chips).toHaveText([/Kitchen/]);
  await expect(chips.first()).toHaveAccessibleName('Kitchen, 1 item');
  await context.close();
});

test('keys an input method is composing with never add or pick a tag (spec §7, the tag field)', async ({
  page,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'tags-ime');
  await addItemViaApi(page.request, base, { title: 'Kettle' });
  await createTagViaApi(page.request, base, 'きっちん');
  await page.goto('/list');
  await titleButton(page, 'Kettle').click();

  // Mid-conversion, as a Japanese IME has it: the box holds unconfirmed text and a suggestion.
  await tagBox(page).fill('きっ');
  const suggestions = page.getByRole('listbox', { name: 'Tag suggestions' });
  await expect(suggestions.getByRole('option')).toHaveText(['きっちん']);
  // ↑/↓ choose a conversion candidate, not a suggestion; Enter confirms it, not a tag.
  await tagBox(page).dispatchEvent('keydown', { key: 'ArrowDown', isComposing: true });
  await expect(suggestions.getByRole('option', { selected: true })).toHaveCount(0);
  await expect(tagBox(page)).not.toHaveAttribute('aria-activedescendant', /.+/);
  await tagBox(page).dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await expect(removeButtons(page)).toHaveCount(0);
  await expect(tagBox(page)).toHaveValue('きっ');

  // Once composition ends, the same keys work as usual.
  await tagBox(page).press('ArrowDown');
  await tagBox(page).press('Enter');
  await expect(page.getByRole('button', { name: 'Remove きっちん' })).toBeVisible();
});

test('tags many items from the Tags sheet, then renames and deletes the tag (Plan 7b ruling 1)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'tags-sheet');
  for (const title of ['Dutch oven', 'Trail shoes', 'Zester', 'Cookbook']) {
    await addItemViaApi(page.request, base, { title });
  }
  // An empty tag stays in the owner's sheet (design §2).
  await createTagViaApi(page.request, base, 'Garden');
  await page.goto('/list');
  const focusedHeadings = await recordHeadingFocus(page);
  await tagsButton(page).click();
  const sheet = tagsSheet(page);
  await expect(sheet.getByRole('heading', { name: 'Tags' })).toBeFocused();
  await expect(sheet.getByText('Tap a tag to choose its items.')).toBeVisible();
  await expect(tagRow(page)).toHaveText([/Garden\s*0 items/]);
  await expectAccessible(page);

  // Escape in the name field cancels the field, not the sheet.
  await sheet.getByRole('button', { name: 'New tag' }).click();
  await expect(sheet.getByLabel('Tag name')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(sheet.getByLabel('Tag name')).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'New tag' })).toBeFocused();

  // Batch tagging.
  await sheet.getByRole('button', { name: 'New tag' }).click();
  await sheet.getByLabel('Tag name').fill('Kitchen');
  await focusedHeadings();
  await sheet.getByRole('button', { name: 'Add tag' }).click();
  await expect(sheet.getByRole('heading', { name: 'Kitchen' })).toBeFocused();
  // Focus moves once, straight to the new tag: not by way of the "Tags" heading.
  expect(await focusedHeadings()).toEqual(['Kitchen']);
  await expect(sheet.getByText('0 items')).toBeVisible();
  // Every item, in list order.
  await expect(sheet.getByRole('checkbox')).toHaveCount(4);
  await expect(sheet.getByRole('listitem')).toHaveText([
    'Dutch oven',
    'Trail shoes',
    'Zester',
    'Cookbook',
  ]);
  await expectAccessible(page);
  for (const title of ['Dutch oven', 'Zester', 'Cookbook']) {
    await sheet.getByRole('checkbox', { name: title }).check();
    await expect(status(page, `Tagged “${title}”.`)).toBeVisible();
  }
  await sheet.getByRole('checkbox', { name: 'Trail shoes' }).check();
  await sheet.getByRole('checkbox', { name: 'Trail shoes' }).uncheck();
  await expect(status(page, 'Untagged “Trail shoes”.')).toBeVisible();
  await expect(sheet.getByText('3 items')).toBeVisible();
  await sheet.getByRole('button', { name: 'All tags' }).click();
  // Alphabetical, and focus comes back to the tag that was open.
  await expect(tagRow(page)).toHaveText([/Garden\s*0 items/, /Kitchen\s*3 items/]);
  await expect(tagRow(page, 'Kitchen')).toBeFocused();
  await expect(tagRow(page, 'Kitchen')).toHaveAccessibleName('Kitchen, 3 items');
  await expect.poll(() => savedTagCounts(page.request)).toEqual({ Garden: 0, Kitchen: 3 });

  // A new tag with a name the list has opens that tag (the API answers 200 with it).
  await sheet.getByRole('button', { name: 'New tag' }).click();
  await sheet.getByLabel('Tag name').fill('kitchen');
  await sheet.getByRole('button', { name: 'Add tag' }).click();
  await expect(sheet.getByRole('heading', { name: 'Kitchen' })).toBeFocused();
  await expect(sheet.getByText('3 items')).toBeVisible();
  await sheet.getByRole('button', { name: 'All tags' }).click();
  await expect(tagRow(page)).toHaveText([/Garden\s*0 items/, /Kitchen\s*3 items/]);
  expect(await savedTagCounts(page.request)).toEqual({ Garden: 0, Kitchen: 3 });
  let share = await shareChips(page, browser, base);
  // Gifters never see the empty tag.
  await expect(share.chips).toHaveText([/Kitchen/]);
  await expect(share.chips.first()).toHaveAccessibleName('Kitchen, 3 items');
  await share.context.close();

  // Rename.
  await tagRow(page, 'Kitchen').click();
  await sheet.getByRole('button', { name: 'Rename' }).click();
  await expect(sheet.getByLabel('Tag name')).toBeFocused();
  await expect(sheet.getByLabel('Tag name')).toHaveValue('Kitchen');
  await sheet.getByLabel('Tag name').fill('Cooking');
  await focusedHeadings();
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet.getByRole('heading', { name: 'Cooking' })).toBeFocused();
  // The title takes focus once it reads the new name, so that's the name a screen reader hears.
  expect(await focusedHeadings()).toEqual(['Cooking']);
  share = await shareChips(page, browser, base);
  await expect(share.chips).toHaveText([/Cooking/]);
  await share.context.close();

  // A rename onto another tag's name is refused on the field, and the old name stays.
  await sheet.getByRole('button', { name: 'All tags' }).click();
  // Alphabetical, not the order the tags were made in: Cooking was made after Garden.
  await expect(tagRow(page)).toHaveText([/Cooking\s*3 items/, /Garden\s*0 items/]);
  await tagRow(page, 'Garden').click();
  await sheet.getByRole('button', { name: 'Rename' }).click();
  await sheet.getByLabel('Tag name').fill('cooking');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet.getByText('You already have a tag called that.')).toBeVisible();
  await expect(sheet.getByLabel('Tag name')).toHaveAttribute('aria-invalid', 'true');
  await expect(sheet.getByLabel('Tag name')).toBeFocused();
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(sheet.getByRole('heading', { name: 'Garden' })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Rename' })).toBeFocused();
  expect(await savedTagCounts(page.request)).toEqual({ Cooking: 3, Garden: 0 });

  // Delete.
  await sheet.getByRole('button', { name: 'All tags' }).click();
  await tagRow(page, 'Cooking').click();
  await sheet.getByRole('button', { name: 'Delete' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Remove “Cooking” from 3 items?' });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('The items stay on your list.');
  await expectAccessible(page);
  await confirm.getByRole('button', { name: 'Delete tag' }).click();
  await expect(status(page, 'Deleted “Cooking”.')).toBeVisible();
  await expect(sheet.getByRole('heading', { name: 'Tags' })).toBeFocused();
  await expect(tagRow(page)).toHaveText([/Garden\s*0 items/]);
  await expect.poll(() => savedTagCounts(page.request)).toEqual({ Garden: 0 });
  share = await shareChips(page, browser, base);
  await expect(
    share.gifter
      .getByRole('list', { name: /items, most wanted first$/ })
      .getByRole('heading', { level: 2 }),
  ).toHaveText(['Dutch oven', 'Trail shoes', 'Zester', 'Cookbook']);
  await expect(share.chips).toHaveCount(0);
  await share.context.close();
});

test('a tag deleted in the Tags sheet leaves the open item form, and saving keeps it gone (RF3)', async ({
  page,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'tags-sheet-rf3');
  const kettle = await addItemViaApi(page.request, base, {
    title: 'Kettle',
    tags: [{ name: 'Christmas' }, { name: 'Kitchen' }],
  });
  await page.goto('/list');
  await titleButton(page, 'Kettle').click();
  await expect(page.getByRole('button', { name: 'Remove Christmas' })).toBeVisible();

  await tagsButton(page).click();
  await tagRow(page, 'Christmas').click();
  await tagsSheet(page).getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete tag' }).click();
  await expect(status(page, 'Deleted “Christmas”.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tagsSheet(page)).toHaveCount(0);

  await expect(page.getByRole('button', { name: 'Remove Christmas' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Remove Kitchen' })).toBeVisible();
  await page.getByLabel('Title').fill('Stovetop kettle');
  const patch = page.waitForRequest(
    (request) => request.method() === 'PATCH' && request.url().endsWith(`/items/${kettle.id}`),
  );
  await page.getByRole('button', { name: 'Save' }).click();
  expect(Object.keys((await patch).postDataJSON() as Record<string, unknown>)).not.toContain(
    'tags',
  );
  await expect(status(page, 'Saved “Stovetop kettle”.')).toBeVisible();
  await expect.poll(() => savedTagCounts(page.request)).toEqual({ Kitchen: 1 });
});

test('the Tags sheet opens, ticks and closes from the keyboard alone (RF4)', async ({
  page,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'tags-sheet-keys');
  await addItemViaApi(page.request, base, { title: 'Kettle' });
  await createTagViaApi(page.request, base, 'Kitchen');
  await page.goto('/list');
  await tagsButton(page).focus();
  await page.keyboard.press('Enter');
  const sheet = tagsSheet(page);
  await expect(sheet.getByRole('heading', { name: 'Tags' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(sheet.getByRole('button', { name: 'Close' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(tagRow(page, 'Kitchen')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(sheet.getByRole('heading', { name: 'Kitchen' })).toBeFocused();
  // Past Rename and Delete to the first item.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(sheet.getByRole('checkbox', { name: 'Kettle' })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(sheet.getByRole('checkbox', { name: 'Kettle' })).toBeChecked();
  await expect(status(page, 'Tagged “Kettle”.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(tagsButton(page)).toBeFocused();
  await expect.poll(() => savedTagCounts(page.request)).toEqual({ Kitchen: 1 });
});
