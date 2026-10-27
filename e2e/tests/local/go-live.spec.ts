import { expect, test } from '@playwright/test';
import { PASSWORD, uniqueEmail } from '../../support/accounts.js';
import { addItemViaApi, verifiedOwner } from '../../support/owner.js';
import { passTurnstile } from '../../support/turnstile.js';

// Cloudflare's script, wherever the page asks for it.
const TURNSTILE_SCRIPT = '**/turnstile/v0/api.js*';
const FINISH_CHECK = 'Finish the security check above, then try again.';
const BLOCKED =
  'We couldn’t load the security check. If you use a content blocker, allow hanker.dev, or try another browser.';

test('a blocked security check says why, instead of leaving the form stuck (D38)', async ({
  page,
}) => {
  await page.route(TURNSTILE_SCRIPT, (route) => route.abort('blockedbyclient'));
  for (const path of ['/signup', '/reset-password']) {
    await page.goto(path);
    await expect(page.getByRole('alert').filter({ hasText: BLOCKED })).toHaveText(BLOCKED);
  }
});

test('the reminder to finish the check goes once the check is done (D38)', async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(TURNSTILE_SCRIPT, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto('/signup');
  await page.getByLabel('Your name').fill('Ada');
  await page.getByLabel('Email').fill(uniqueEmail('finish-check'));
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText(FINISH_CHECK)).toBeVisible();
  release();
  await passTurnstile(page);
  await expect(page.getByText(FINISH_CHECK)).toHaveCount(0);
});

test('a list change that fails after leaving the list still says so (3b carry)', async ({
  page,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'off-page');
  await addItemViaApi(page.request, base, { title: 'Kettle' });
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/wishlist/items/*', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    await held;
    await route.fulfill({
      status: 500,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'about:blank',
        title: 'Internal Server Error',
        status: 500,
        code: 'INTERNAL_ERROR',
        requestId: 'e2e',
      }),
    });
  });
  const mainNav = page.getByRole('navigation', { name: 'Main' });
  await page.goto('/list');
  await page.getByRole('button', { name: /^Kettle/ }).click();
  await page.getByLabel('Title', { exact: true }).fill('Stovetop kettle');
  await page.getByRole('button', { name: 'Save' }).click();
  await mainNav.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  release();
  await expect(
    page.getByRole('alert').filter({ hasText: 'A change to your list didn’t save.' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Check your list' }).click();
  await expect(page.getByRole('heading', { level: 1, name: "Ada's wishlist" })).toBeVisible();
  await mainNav.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByText('A change to your list didn’t save.')).toHaveCount(0);
});
