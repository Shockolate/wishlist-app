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

test('says why the box can’t take what was typed, and announces it every time', async ({
  page,
  baseURL,
}) => {
  await verifiedOwner(page, baseURL ?? '', 'refused');
  await page.goto('/list');
  const alert = (text: string) => page.getByRole('alert').filter({ hasText: text });
  await addThroughTheBox(page, '   ');
  await expect(alert('Paste a link or type an idea.')).toBeVisible();
  await expect(page.getByLabel('Add to your list')).toHaveAccessibleDescription(
    'Paste a link or type an idea.',
  );
  // The same refusal again must be a new alert, or a screen reader says nothing the second time.
  await alert('Paste a link or type an idea.').evaluate((el) => el.setAttribute('data-seen', ''));
  await addThroughTheBox(page, '   ');
  await expect(alert('Paste a link or type an idea.')).toBeVisible();
  await expect(alert('Paste a link or type an idea.')).not.toHaveAttribute('data-seen', '');
  await addThroughTheBox(page, 'ftp://files.example/kettle');
  await expect(alert('Links must start with http:// or https://')).toBeVisible();
  await addThroughTheBox(page, 'K'.repeat(201));
  await expect(alert('Use 200 characters or fewer.')).toBeVisible();
  await expect(rowsOf(page)).toHaveCount(0);
});

test('says the page is being read while unfurl runs', async ({ page, baseURL }) => {
  await verifiedOwner(page, baseURL ?? '', 'reading');
  await page.route('**/api/wishlist/unfurl', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ title: 'Kettle' }),
    });
  });
  await page.goto('/list');
  await addThroughTheBox(page, 'https://hanker-e2e.invalid/kettle');
  await expect(status(page, 'Reading the page…')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Skip, I’ll type them' })).toHaveCount(0);
  await expect(page.getByLabel('Title')).toHaveValue('Kettle');
});

const AMAZON = 'https://www.amazon.com/dp/B08FK7B2SC';

test('an Amazon link shows the waiting panel, then the prefill (retailer lookups §5.5)', async ({
  page,
  baseURL,
}) => {
  await verifiedOwner(page, baseURL ?? '', 'amazon-wait');
  await page.route('**/api/wishlist/unfurl', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ title: 'Cephalofair Games: Frosthaven' }),
    });
  });
  await page.goto('/list');
  await addThroughTheBox(page, AMAZON);
  await expect(status(page, 'Getting the details from Amazon…')).toBeVisible();
  await expect(page.getByText('Amazon can take up to half a minute.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Skip, I’ll type them' })).toBeVisible();
  await expectAccessible(page);
  await expect(page.getByLabel('Title')).toHaveValue('Cephalofair Games: Frosthaven');
});

test('Skip opens the form at once, and a late answer doesn’t overwrite it (Review Focus 3)', async ({
  page,
  baseURL,
}) => {
  await verifiedOwner(page, baseURL ?? '', 'amazon-skip');
  await page.route('**/api/wishlist/unfurl', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route
      .fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ title: 'Late title' }),
      })
      .catch(() => undefined); // The browser may have aborted it.
  });
  await page.goto('/list');
  await addThroughTheBox(page, AMAZON);
  await page.getByRole('button', { name: 'Skip, I’ll type them' }).click();
  await expect(status(page, 'Fill in the details yourself.')).toBeVisible();
  await expect(page.getByLabel('Link', { exact: true })).toHaveValue(AMAZON);
  const title = page.getByLabel('Title');
  await expect(title).toBeFocused();
  await title.fill('My own title');
  await page.waitForTimeout(3500);
  await expect(title).toHaveValue('My own title');
});

test('an Amazon lookup that can’t answer names Amazon (retailer lookups §5.4)', async ({
  page,
  baseURL,
}) => {
  await verifiedOwner(page, baseURL ?? '', 'amazon-down');
  await page.route('**/api/wishlist/unfurl', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ failureReason: 'LOOKUP_UNAVAILABLE' }),
    }),
  );
  await page.goto('/list');
  await addThroughTheBox(page, AMAZON);
  await expect(
    status(page, 'We couldn’t get the details from Amazon right now, so fill them in yourself.'),
  ).toBeVisible();
  await expect(page.getByLabel('Link', { exact: true })).toHaveValue(AMAZON);
});

test('the quantity stepper hands focus on when a button reaches its limit', async ({
  page,
  baseURL,
}) => {
  await verifiedOwner(page, baseURL ?? '', 'stepper');
  await page.goto('/list');
  await addThroughTheBox(page, 'https://hanker-e2e.invalid/kettle');
  const more = page.getByRole('button', { name: 'More' });
  const fewer = page.getByRole('button', { name: 'Fewer' });
  await more.click();
  await expect(page.getByRole('group', { name: 'How many' })).toContainText('2');
  await fewer.click();
  await expect(fewer).toBeDisabled();
  await expect(more).toBeFocused();
});

test('removing the photo moves focus to the Photo link field', async ({ page, baseURL }) => {
  await verifiedOwner(page, baseURL ?? '', 'photo');
  await page.route('**/api/wishlist/unfurl', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ title: 'Kettle', imageUrl: 'https://hanker-e2e.invalid/k.jpg' }),
    }),
  );
  await page.goto('/list');
  await addThroughTheBox(page, 'https://hanker-e2e.invalid/kettle');
  await page.getByRole('button', { name: 'Remove photo' }).click();
  const photoLink = page.getByLabel('Photo link');
  await expect(photoLink).toHaveValue('');
  await expect(photoLink).toBeFocused();
  await expect(page.getByRole('button', { name: 'Remove photo' })).toHaveCount(0);
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
