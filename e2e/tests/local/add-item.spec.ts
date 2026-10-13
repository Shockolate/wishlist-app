import { expect, test, type Page } from '@playwright/test';
import { expectAccessible } from '../../support/a11y.js';
import { verifiedOwner } from '../../support/owner.js';

const rowsOf = (page: Page) =>
  page.getByRole('list', { name: 'Your items, most wanted first' }).getByRole('listitem');
const status = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

async function addThroughTheBox(page: Page, text: string) {
  await page.getByLabel('Add to your list').fill(text);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
}

test('adds an idea in one step, and is ready for the next', async ({ page, baseURL }) => {
  await verifiedOwner(page, baseURL ?? '', 'idea');
  await page.goto('/list');
  await addThroughTheBox(page, 'Pottery class for two');
  await expect(status(page, 'Added “Pottery class for two”.')).toBeVisible();
  await expect(rowsOf(page)).toHaveCount(1);
  await expect(rowsOf(page).first()).toContainText('An idea');
  const box = page.getByLabel('Add to your list');
  await expect(box).toHaveValue('');
  await expect(box).toBeFocused();
});

test('a link whose site can’t be found opens the form with the link kept (Plan 3b rule 6)', async ({
  page,
  baseURL,
}) => {
  await verifiedOwner(page, baseURL ?? '', 'dns');
  await page.goto('/list');
  await addThroughTheBox(page, 'https://hanker-e2e.invalid/kettle');
  await expect(status(page, 'We couldn’t find that site.')).toBeVisible();
  await expect(page.getByLabel('Link', { exact: true })).toHaveValue(
    'https://hanker-e2e.invalid/kettle',
  );
  await expect(page.getByLabel('Title')).toBeFocused();
  await expectAccessible(page);
  await page.getByLabel('Title').fill('Enamel kettle');
  await page.getByLabel('Price').fill('$48.00');
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Add to list' }).click();
  await expect(status(page, 'Added “Enamel kettle”.')).toBeVisible();
  const row = rowsOf(page).first();
  await expect(row).toContainText('$48.00');
  await expect(row).toContainText('2 wanted');
  await expect(row).toContainText('hanker-e2e.invalid');
});

test('text shared from a phone app becomes the title when the page gives none (Review Focus 1)', async ({
  page,
  baseURL,
}) => {
  await verifiedOwner(page, baseURL ?? '', 'shared');
  await page.goto('/list');
  await addThroughTheBox(page, 'Garmin Approach CT10 https://hanker-e2e.invalid/garmin');
  await expect(page.getByLabel('Title')).toHaveValue('Garmin Approach CT10');
  await expect(page.getByLabel('Link', { exact: true })).toHaveValue(
    'https://hanker-e2e.invalid/garmin',
  );
});

test('a shop address without https:// is read as a link', async ({ page, baseURL }) => {
  await verifiedOwner(page, baseURL ?? '', 'bare');
  await page.goto('/list');
  await addThroughTheBox(page, 'hanker-e2e.invalid/socks');
  await expect(page.getByLabel('Link', { exact: true })).toHaveValue(
    'https://hanker-e2e.invalid/socks',
  );
});

test('says why the box can’t take what was typed', async ({ page, baseURL }) => {
  await verifiedOwner(page, baseURL ?? '', 'refused');
  await page.goto('/list');
  await addThroughTheBox(page, '   ');
  await expect(page.getByText('Paste a link or type an idea.')).toBeVisible();
  await addThroughTheBox(page, 'ftp://files.example/kettle');
  await expect(page.getByText('Links must start with http:// or https://')).toBeVisible();
  await addThroughTheBox(page, 'K'.repeat(201));
  await expect(page.getByText('Use 200 characters or fewer.')).toBeVisible();
  await expect(rowsOf(page)).toHaveCount(0);
});

test('a rate-limited unfurl still opens the form, with the link kept (3a carry)', async ({
  page,
  baseURL,
}) => {
  await verifiedOwner(page, baseURL ?? '', 'limited');
  await page.route('**/api/wishlist/unfurl', (route) =>
    route.fulfill({
      status: 429,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'about:blank',
        title: 'Too Many Requests',
        status: 429,
        code: 'RATE_LIMITED',
        requestId: 'e2e',
      }),
    }),
  );
  await page.goto('/list');
  await addThroughTheBox(page, 'https://hanker-e2e.invalid/kettle');
  await expect(status(page, 'You’ve added a lot of links this hour')).toBeVisible();
  await expect(page.getByLabel('Link', { exact: true })).toHaveValue(
    'https://hanker-e2e.invalid/kettle',
  );
});

test('Cancel puts the text back in the box', async ({ page, baseURL }) => {
  await verifiedOwner(page, baseURL ?? '', 'cancel');
  await page.goto('/list');
  await addThroughTheBox(page, 'https://hanker-e2e.invalid/kettle');
  await page.getByRole('button', { name: 'Cancel' }).click();
  const box = page.getByLabel('Add to your list');
  await expect(box).toHaveValue('https://hanker-e2e.invalid/kettle');
  await expect(box).toBeFocused();
});
