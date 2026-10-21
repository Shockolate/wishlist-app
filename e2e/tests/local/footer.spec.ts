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
