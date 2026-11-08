import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectAccessible } from '../../support/a11y.js';
import { addItemViaApi, verifiedOwner } from '../../support/owner.js';

// D117: a link pasted into the add form's Link field fills in what is still empty.

const rowsOf = (page: Page) =>
  page.getByRole('list', { name: 'Your items, most wanted first' }).getByRole('listitem');
const status = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });
const linkField = (page: Page) => page.getByLabel('Link', { exact: true });
const LINK = 'https://hanker-e2e.invalid/kettle';
const AMAZON = 'https://www.amazon.com/dp/B08FK7B2SC';

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
});

async function openIdea(page: Page, idea: string) {
  await page.goto('/list');
  await page.getByLabel('Add to your list').fill(idea);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('form', { name: 'New item' })).toBeVisible();
}

/** A real paste: the text goes on the clipboard, then Ctrl+V into the field. */
async function paste(page: Page, field: Locator, text: string) {
  await page.evaluate(
    (value) =>
      (
        globalThis as unknown as {
          navigator: { clipboard: { writeText(text: string): Promise<void> } };
        }
      ).navigator.clipboard.writeText(value),
    text,
  );
  await field.focus();
  await page.keyboard.press('ControlOrMeta+V');
}

/** Stubs unfurl, answering `body` after `delay` ms, and records the links it was asked to read. */
async function stubUnfurl(page: Page, body: Record<string, string>, delay = 0) {
  const asked: string[] = [];
  await page.route('**/api/wishlist/unfurl', async (route) => {
    asked.push((route.request().postDataJSON() as { url: string }).url);
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    await route
      .fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
      .catch(() => undefined); // The browser may have aborted it.
  });
  return asked;
}

test('a link pasted into an idea’s form fills in what’s still empty, and keeps what was typed', async ({
  page,
  baseURL,
}) => {
  await verifiedOwner(page, baseURL ?? '', 'paste-fill');
  const asked = await stubUnfurl(
    page,
    {
      title: 'Stagg EKG kettle',
      priceText: '$165.00',
      imageUrl: 'https://hanker-e2e.invalid/k.jpg',
    },
    1000,
  );
  await openIdea(page, 'Blue kettle');
  await paste(page, linkField(page), LINK);
  await expect(status(page, 'Reading the page…')).toBeVisible();
  await expect(
    status(page, 'Filled in from hanker-e2e.invalid. Check it, then add it.'),
  ).toBeVisible();
  expect(asked).toEqual([LINK]);
  await expect(page.getByLabel('Title')).toHaveValue('Blue kettle');
  await expect(page.getByLabel('Price')).toHaveValue('$165.00');
  await expect(page.getByLabel('Photo link')).toHaveValue('https://hanker-e2e.invalid/k.jpg');
  await expect(linkField(page)).toHaveValue(LINK);
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Add to list' }).click();
  await expect(status(page, 'Added “Blue kettle”.')).toBeVisible();
  await expect(rowsOf(page).first()).toContainText('$165.00');
});

test('a link typed into the field isn’t read', async ({ page, baseURL }) => {
  await verifiedOwner(page, baseURL ?? '', 'paste-typed');
  const asked = await stubUnfurl(page, { title: 'Stagg EKG kettle' });
  await openIdea(page, 'Blue kettle');
  await linkField(page).pressSequentially(LINK);
  await page.getByLabel('Price').click();
  await page.waitForTimeout(500);
  expect(asked).toEqual([]);
  await expect(page.getByLabel('Title')).toHaveValue('Blue kettle');
});

test('a page that can’t be read says so, and clears nothing', async ({ page, baseURL }) => {
  await verifiedOwner(page, baseURL ?? '', 'paste-fail');
  await stubUnfurl(page, { failureReason: 'NO_METADATA' });
  await openIdea(page, 'Blue kettle');
  await page.getByLabel('Price').fill('$10');
  await paste(page, linkField(page), LINK);
  await expect(
    status(page, 'We couldn’t find the details on that page. Add them below.'),
  ).toBeVisible();
  await expect(page.getByLabel('Title')).toHaveValue('Blue kettle');
  await expect(page.getByLabel('Price')).toHaveValue('$10');
  await expect(linkField(page)).toHaveValue(LINK);
});

test('an Amazon link pasted into the form can be skipped, and its late answer fills nothing', async ({
  page,
  baseURL,
}) => {
  await verifiedOwner(page, baseURL ?? '', 'paste-amazon');
  await stubUnfurl(page, { title: 'Late title', priceText: '$1.00' }, 3000);
  await openIdea(page, 'Board game');
  await paste(page, linkField(page), AMAZON);
  await expect(status(page, 'Getting the details from Amazon…')).toBeVisible();
  await page.getByRole('button', { name: 'Skip, I’ll type them' }).click();
  await expect(status(page, 'Fill in the details yourself.')).toBeVisible();
  await page.waitForTimeout(3500);
  await expect(page.getByLabel('Price')).toHaveValue('');
});

test('Add while a pasted link is being read saves the item as it stands', async ({
  page,
  baseURL,
}) => {
  await verifiedOwner(page, baseURL ?? '', 'paste-add');
  await stubUnfurl(page, { title: 'Late title', priceText: '$1.00' }, 3000);
  await openIdea(page, 'Blue kettle');
  await paste(page, linkField(page), LINK);
  await expect(status(page, 'Reading the page…')).toBeVisible();
  await page.getByRole('button', { name: 'Add to list' }).click();
  await expect(status(page, 'Added “Blue kettle”.')).toBeVisible();
  await page.waitForTimeout(3500);
  await expect(rowsOf(page)).toHaveCount(1);
  await expect(rowsOf(page).first()).not.toContainText('$1.00');
});

test('a link pasted while editing a saved item isn’t read', async ({ page, baseURL }) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'paste-edit');
  await addItemViaApi(page.request, base, { title: 'Blue kettle' });
  const asked = await stubUnfurl(page, { title: 'Stagg EKG kettle', priceText: '$165.00' });
  await page.goto('/list');
  await page.getByRole('button', { name: /^Blue kettle/ }).click();
  const edit = page.getByRole('form', { name: 'Edit Blue kettle' });
  await paste(page, edit.getByLabel('Link', { exact: true }), LINK);
  await expect(edit.getByLabel('Link', { exact: true })).toHaveValue(LINK);
  await page.waitForTimeout(500);
  expect(asked).toEqual([]);
  await expect(edit.getByLabel('Price')).toHaveValue('');
});
