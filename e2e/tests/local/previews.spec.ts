import { expect, test, type Page } from '@playwright/test';
import type { WishlistResponse } from '@wishlist/contracts';
import { addItemViaApi, verifiedOwner } from '../../support/owner.js';
import { claimViaApi, guest, shareTokenOf } from '../../support/share.js';

const og = (page: Page, property: string) =>
  page.locator(`meta[property="${property}"]`).getAttribute('content');

/** Everything in <head> that a preview fetcher could read: meta contents and link hrefs. */
async function headValues(page: Page): Promise<string[]> {
  const metas = await page.locator('head meta').all();
  const links = await page.locator('head link').all();
  const values = await Promise.all([
    ...metas.map((meta) => meta.getAttribute('content')),
    ...links.map((link) => link.getAttribute('href')),
  ]);
  return values.filter((value): value is string => value !== null);
}

test('the landing page previews as Hanker with the tag image', async ({ page }) => {
  await page.goto('/');
  expect(await og(page, 'og:title')).toBe('Hanker');
  expect(await og(page, 'og:image')).toBe('https://hanker.dev/hanker-preview.png');
  expect(await page.locator('meta[name="twitter:card"]').getAttribute('content')).toBe(
    'summary_large_image',
  );
  await expect(page.locator('meta[property="og:url"]')).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
});

test('a share link previews the list title and one line, with no token or item in any meta tag', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'previews-share');
  await addItemViaApi(page.request, base, { title: 'Enamel stovetop kettle' });
  const { title } = (await (await page.request.get('/api/wishlist')).json()) as WishlistResponse;
  const token = await shareTokenOf(page.request);

  const gifter = await (await guest(browser, base)).newPage();
  await gifter.goto(`/s/${token}`);
  expect(await og(gifter, 'og:title')).toBe(title);
  expect(await og(gifter, 'og:description')).toBe('Pick a gift so nobody doubles up.');
  expect(await og(gifter, 'og:image')).toBe('https://hanker.dev/hanker-preview.png');
  await expect(gifter.locator('meta[property="og:url"]')).toHaveCount(0);
  for (const value of await headValues(gifter)) {
    expect(value).not.toContain(token);
    expect(value).not.toContain('Enamel stovetop kettle');
  }
});

test('a claim page previews only the site defaults', async ({ page, browser, baseURL }) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'previews-claim');
  const item = await addItemViaApi(page.request, base, { title: 'Merino hiking socks' });
  const token = await shareTokenOf(page.request);
  const context = await guest(browser, base);
  const { manageUrl } = await claimViaApi(context.request, base, token, item.id, {
    claimerName: 'Sam',
  });
  const manageToken = new URL(manageUrl).pathname.split('/c/')[1] ?? '';
  expect(manageToken).not.toBe('');

  const gifter = await context.newPage();
  await gifter.goto(new URL(manageUrl).pathname);
  expect(await og(gifter, 'og:title')).toBe('Hanker');
  for (const value of await headValues(gifter)) {
    expect(value).not.toContain(manageToken);
  }
});
