import { expect, test, type Page } from '@playwright/test';
import type { WishlistResponse } from '@wishlist/contracts';
import { jpegSize } from '../../support/jpeg.js';
import { addItemViaApi, verifiedOwner } from '../../support/owner.js';
import { claimViaApi, guest, shareTokenOf } from '../../support/share.js';

const og = (page: Page, property: string) =>
  page.locator(`meta[property="${property}"]`).getAttribute('content');

/**
 * Everything in <head> that a preview fetcher could read, by what names it: meta contents under
 * their `property` or `name`, and link hrefs under their `rel`.
 */
async function headEntries(page: Page): Promise<{ key: string; value: string }[]> {
  const metas = await page.locator('head meta').all();
  const links = await page.locator('head link').all();
  const entries = await Promise.all([
    ...metas.map(async (meta) => ({
      key: (await meta.getAttribute('property')) ?? (await meta.getAttribute('name')) ?? 'meta',
      value: await meta.getAttribute('content'),
    })),
    ...links.map(async (link) => ({
      key: (await link.getAttribute('rel')) ?? 'link',
      value: await link.getAttribute('href'),
    })),
  ]);
  return entries.filter((entry): entry is { key: string; value: string } => entry.value !== null);
}

async function headValues(page: Page): Promise<string[]> {
  return (await headEntries(page)).map((entry) => entry.value);
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

test('a share link previews the title, count and its own image, with no item named', async ({
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
  expect(await og(gifter, 'og:description')).toBe(
    '1 thing on Ada’s list. Pick a gift so nobody doubles up.',
  );
  expect(await og(gifter, 'og:image')).toBe(`https://hanker.dev/s/${token}/preview.jpg`);
  expect(await og(gifter, 'og:image:alt')).toBe(`${title}: 1 thing on the list`);
  expect(await gifter.locator('meta[name="twitter:card"]').getAttribute('content')).toBe(
    'summary_large_image',
  );
  await expect(gifter.locator('meta[property="og:url"]')).toHaveCount(0);
  const entries = await headEntries(gifter);
  for (const { value } of entries) expect(value).not.toContain('Enamel stovetop kettle');
  // Design §5.3: the image's URL carries the token on purpose, and nothing else in <head> does.
  expect(
    entries
      .filter(({ value }) => value.includes(token))
      .map(({ key }) => key)
      .sort(),
  ).toEqual(['og:image', 'twitter:image']);
});

test('the preview image is a 1200×630 JPEG under 300 KB, with the share page’s headers', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'previews-image');
  await addItemViaApi(page.request, base, { title: 'Linen apron' });
  const token = await shareTokenOf(page.request);

  const chatApp = (await guest(browser, base)).request;
  const res = await chatApp.get(`/s/${token}/preview.jpg`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('image/jpeg');
  expect(res.headers()['cache-control']).toBe('public, max-age=0, s-maxage=600');
  expect(res.headers()['referrer-policy']).toBe('no-referrer');
  expect(res.headers()['x-robots-tag']).toBe('noindex');
  const body = await res.body();
  expect(body.byteLength).toBeLessThanOrEqual(307_200);
  expect(jpegSize(body)).toEqual({ width: 1200, height: 630 });
});

test('a photo the API won’t fetch still gives a preview', async ({ page, browser, baseURL }) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'previews-refused');
  // A loopback address: the API's address policy refuses it, so the photo is skipped.
  await addItemViaApi(page.request, base, {
    title: 'Cast iron skillet',
    imageUrl: 'https://127.0.0.1/x.jpg',
  });
  const token = await shareTokenOf(page.request);

  const res = await (await guest(browser, base)).request.get(`/s/${token}/preview.jpg`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('image/jpeg');
  expect(jpegSize(await res.body())).toEqual({ width: 1200, height: 630 });
});

test('a claim doesn’t change the preview', async ({ page, browser, baseURL }) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'previews-claimed');
  const item = await addItemViaApi(page.request, base, { title: 'Wool blanket' });
  const token = await shareTokenOf(page.request);
  const context = await guest(browser, base);
  const gifter = await context.newPage();
  const preview = async () => {
    await gifter.goto(`/s/${token}`);
    return [await og(gifter, 'og:description'), await og(gifter, 'og:image:alt')];
  };

  const before = await preview();
  await claimViaApi(context.request, base, token, item.id, { claimerName: 'Sam' });
  expect(await preview()).toEqual(before);
});

test('a dead link’s image is 404', async ({ page, browser, baseURL }) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'previews-dead');
  const token = await shareTokenOf(page.request);
  const rotated = await page.request.post('/api/wishlist/share-token/rotate', {
    headers: { origin: base },
    data: {},
  });
  expect(rotated.status()).toBe(200);

  const res = await (await guest(browser, base)).request.get(`/s/${token}/preview.jpg`);
  expect(res.status()).toBe(404);
});

test('the preview image refuses a query string, so it can’t dodge the CDN cache', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'previews-query');
  const token = await shareTokenOf(page.request);

  const chatApp = (await guest(browser, base)).request;
  expect((await chatApp.get(`/s/${token}/preview.jpg`)).status()).toBe(200);
  const res = await chatApp.get(`/s/${token}/preview.jpg?n=1`);
  expect(res.status()).toBe(404);
  expect(res.headers()['x-robots-tag']).toBe('noindex');
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
