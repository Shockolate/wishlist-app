import { expect, test } from '@playwright/test';
import { expectAccessible, expectFitsPhone } from '../../support/a11y.js';
import { addItemViaApi, verifiedOwner } from '../../support/owner.js';
import { claimViaApi, guest, shareTokenOf } from '../../support/share.js';

test('a gifter sees the list, who is getting what, and that Ada can’t see it (spec §7, D40)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'share-read');
  const kettle = await addItemViaApi(page.request, base, {
    title: 'Enamel stovetop kettle',
    url: 'https://www.hearthware.example/kettle',
    priceText: '$48.00',
  });
  const socks = await addItemViaApi(page.request, base, {
    title: 'Merino hiking socks',
    quantity: 3,
    note: 'Size M. Any colour but white.',
  });
  await addItemViaApi(page.request, base, { title: 'Pottery class for two' });
  const token = await shareTokenOf(page.request);
  const others = await guest(browser, base);
  await claimViaApi(others.request, base, token, kettle.id, { claimerName: 'Aunt Sue' });
  await claimViaApi(others.request, base, token, socks.id, { claimerName: 'Sam' });

  const gifter = await (await guest(browser, base)).newPage();
  const res = await gifter.goto(`/s/${token}`);
  expect(res?.status()).toBe(200);
  expect(res?.headers()['referrer-policy']).toBe('no-referrer');
  expect(res?.headers()['x-robots-tag']).toBe('noindex');
  await expect(gifter).toHaveTitle("Ada's wishlist | Hanker");
  await expect(gifter.getByRole('heading', { level: 1, name: "Ada's wishlist" })).toBeVisible();
  await expect(
    gifter.getByText('Ada can’t see who’s getting what, so the surprise is safe.'),
  ).toBeVisible();
  const cards = gifter
    .getByRole('list', { name: 'Ada’s items, most wanted first' })
    .getByRole('listitem');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText('Taken care of: Aunt Sue is getting this');
  await expect(cards.nth(1)).toContainText('Ada wants 3. Sam is getting 1, so 2 are left.');
  await expect(cards.nth(1)).toContainText('Size M. Any colour but white.');
  await expect(cards.nth(2)).toContainText('An idea');
  await expect(
    cards.nth(0).getByRole('link', { name: 'See it at hearthware.example' }),
  ).toHaveAttribute('rel', 'noopener noreferrer');
  await expectAccessible(gifter);
});

test('the owner on their own link sees no claim, no claimer, and a way back (spec §2, Review Focus 5)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'share-owner');
  const kettle = await addItemViaApi(page.request, base, { title: 'Enamel kettle' });
  const token = await shareTokenOf(page.request);
  await claimViaApi((await guest(browser, base)).request, base, token, kettle.id, {
    claimerName: 'Aunt Sue',
  });

  await page.goto(`/s/${token}`);
  await expect(page.getByText('Claims are hidden from you, so nothing’s spoiled.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit your list' })).toHaveAttribute('href', '/list');
  await expect(page.getByText('Taken care of')).toHaveCount(0);
  // Not in the page, nor in the data the page was rendered from.
  expect(await page.content()).not.toContain('Aunt Sue');
  await expectAccessible(page);
});

test('a replaced, unknown or mangled link gets the dead-link page with a 404 (spec §2)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'share-dead');
  const token = await shareTokenOf(page.request);
  const rotated = await page.request.post('/api/wishlist/share-token/rotate', {
    headers: { origin: base },
    data: {},
  });
  expect(rotated.status()).toBe(200);

  const visitor = await (await guest(browser, base)).newPage();
  for (const path of [
    `/s/${token}`,
    '/s/abcdefghijklmnopqrstuv',
    '/s/not-a-token',
    `/s/${token}.`,
  ]) {
    const res = await visitor.goto(path);
    expect(res?.status(), path).toBe(404);
    await expect(
      visitor.getByRole('heading', { level: 1, name: 'This list’s link doesn’t work.' }),
    ).toBeVisible();
  }
  await expect(
    visitor.getByText('If you claimed something, the link you saved for your claim still works.'),
  ).toBeVisible();
  await expectAccessible(visitor);
});

test('long titles, names and shops fit a phone (Review Focus 4)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'share-long');
  const renamed = await page.request.patch('/api/wishlist', {
    headers: { origin: base },
    data: { title: 'W'.repeat(100) },
  });
  expect(renamed.status()).toBe(200);
  const socks = await addItemViaApi(page.request, base, {
    title: 'Extraordinarily'.repeat(14).slice(0, 200),
    url: 'https://www.a-very-long-shop-name-that-keeps-going-for-testing.example/item',
    priceText: '$'.padEnd(50, '9'),
    quantity: 3,
  });
  const token = await shareTokenOf(page.request);
  await claimViaApi((await guest(browser, base)).request, base, token, socks.id, {
    claimerName: 'Bartholomew'.repeat(5).slice(0, 50),
  });

  const gifter = await (await guest(browser, base)).newPage();
  await expectFitsPhone(gifter, `/s/${token}`);
  await expectAccessible(gifter);
});
