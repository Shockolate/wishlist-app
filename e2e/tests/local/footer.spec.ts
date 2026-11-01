import { expect, test, type Page } from '@playwright/test';
import { addItemViaApi, verifiedOwner } from '../../support/owner.js';
import { guest, shareTokenOf } from '../../support/share.js';

async function expectFooter(page: Page) {
  const footer = page.getByRole('contentinfo');
  const links = footer.getByRole('link');
  await expect(links).toHaveCount(4);
  const expected = [
    ['Source on GitHub', 'https://github.com/Shockolate/wishlist-app'],
    ['Privacy', '/privacy'],
    ['Terms', '/terms'],
    ['hello@hanker.dev', 'mailto:hello@hanker.dev'],
  ] as const;
  for (const [index, [name, href]] of expected.entries()) {
    await expect(links.nth(index)).toHaveAccessibleName(name);
    await expect(links.nth(index)).toHaveAttribute('href', href);
  }
  await expect(footer).not.toContainText('Ted');
}

test('the footer is on the landing page, the login page and a 404', async ({ page }) => {
  for (const path of ['/', '/login', '/no-such-page']) {
    await page.goto(path);
    await expectFooter(page);
  }
});

test('a gifter sees the footer on a share page, below the list', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'footer-share');
  await addItemViaApi(page.request, base, { title: 'Pottery class for two' });
  const token = await shareTokenOf(page.request);

  const gifter = await (await guest(browser, base)).newPage();
  await gifter.goto(`/s/${token}`);
  await expectFooter(gifter);
  const main = await gifter.getByRole('main').boundingBox();
  const footer = await gifter.getByRole('contentinfo').boundingBox();
  expect(footer!.y).toBeGreaterThan(main!.y);
});

const SUPPORT_LINK = { name: 'Buy me a coffee' };

test('an owner sees the support link on their list and settings, and nowhere else', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'footer-support');
  await addItemViaApi(page.request, base, { title: 'Pottery class for two' });
  const token = await shareTokenOf(page.request);
  const footer = page.getByRole('contentinfo');

  for (const path of ['/list', '/settings']) {
    await page.goto(path);
    const link = footer.getByRole('link', SUPPORT_LINK);
    await expect(link).toHaveAttribute('href', 'https://buymeacoffee.com/shockolate');
    await expect(link).toHaveAttribute('rel', 'noreferrer');
  }

  // The footer lives in the root layout, which survives client navigation.
  await page.getByRole('contentinfo').getByRole('link', { name: 'Privacy' }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(footer.getByRole('link', SUPPORT_LINK)).toHaveCount(0);

  // The owner's own views of gifter pages get the plain footer too.
  for (const path of ['/gifts', `/s/${token}`]) {
    await page.goto(path);
    await expectFooter(page);
  }

  const gifter = await (await guest(browser, base)).newPage();
  await gifter.goto(`/s/${token}`);
  await expectFooter(gifter);
});
