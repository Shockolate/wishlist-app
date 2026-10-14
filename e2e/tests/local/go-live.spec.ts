import { expect, test } from '@playwright/test';
import { PASSWORD, uniqueEmail } from '../../support/accounts.js';
import { passTurnstile } from '../../support/turnstile.js';

// Cloudflare's script, wherever the page asks for it.
const TURNSTILE_SCRIPT = '**/turnstile/v0/api.js*';
const FINISH_CHECK = 'Finish the check above, then try again.';
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
