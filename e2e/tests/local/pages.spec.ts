import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { logInViaApi, signUpViaApi, uniqueEmail } from '../../support/accounts.js';
import { passTurnstile } from '../../support/turnstile.js';

const WCAG_22_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const TURNSTILE_PAGES = new Set(['/signup', '/verify-email', '/reset-password']);

async function expectAccessible(page: Page) {
  // Cloudflare's widget is a third-party iframe whose markup we can't change.
  const results = await new AxeBuilder({ page })
    .withTags(WCAG_22_AA)
    .exclude('[data-turnstile]')
    .analyze();
  expect(results.violations).toEqual([]);
}

/**
 * Loads the page fresh at phone width (a resize of a loaded page would hide layout that only
 * breaks on first render), then measures sideways overflow. `networkidle` never settles on
 * these pages, so a finished Turnstile widget is the readiness signal where there is one. (Its
 * iframe sits in a closed shadow root that locators can't reach, so we wait for the token.)
 */
async function expectFitsPhone(page: Page, path: string) {
  await page.setViewportSize(PHONE);
  await page.goto(path);
  if (TURNSTILE_PAGES.has(path)) {
    await passTurnstile(page);
  }
  // e2e has no DOM lib, so the page's globals are typed by hand.
  const overflow = await page.evaluate(() => {
    const { document, innerWidth } = globalThis as unknown as {
      document: { documentElement: { scrollWidth: number } };
      innerWidth: number;
    };
    return document.documentElement.scrollWidth - innerWidth;
  });
  expect(overflow, 'no sideways scrolling at 390px').toBeLessThanOrEqual(0);
}

for (const path of [
  '/',
  '/signup',
  '/login',
  '/verify-email',
  '/reset-password',
  '/reset-password/confirm',
]) {
  test(`${path}: no detectable WCAG 2.2 AA violations, and it fits a phone`, async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(path);
    await expectAccessible(page);
    await expectFitsPhone(page, path);
  });
}

test('sign-up with every field wrong is still accessible', async ({ page }) => {
  await page.goto('/signup');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Enter a name.')).toBeVisible();
  await expectAccessible(page);
});

test('the signed-in pages are accessible and fit a phone', async ({ page, baseURL }) => {
  const email = uniqueEmail('pages');
  await signUpViaApi(page.request, baseURL ?? '', email);
  expect(await logInViaApi(page.request, baseURL ?? '', email)).toBe(204);
  for (const path of ['/list', '/settings']) {
    await page.setViewportSize(DESKTOP);
    await page.goto(path);
    await expectAccessible(page);
    await expectFitsPhone(page, path);
  }
});
