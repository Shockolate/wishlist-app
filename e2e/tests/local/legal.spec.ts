import { expect, test } from '@playwright/test';

test('/privacy names who runs Hanker and how to reach them', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page).toHaveTitle('Privacy | Hanker');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Privacy');
  const main = page.getByRole('main');
  await expect(main).toContainText('Ted Armstrong');
  await expect(main).toContainText('Portland, Maine');
  await expect(main.getByRole('link', { name: 'hello@hanker.dev' }).first()).toHaveAttribute(
    'href',
    'mailto:hello@hanker.dev',
  );
});

test('/terms says who may use Hanker', async ({ page }) => {
  await page.goto('/terms');
  await expect(page).toHaveTitle('Terms | Hanker');
  const main = page.getByRole('main');
  await expect(main).toContainText('13 and older');
  await expect(main).toContainText('Maine law');
});
