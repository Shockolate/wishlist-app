import { expect, test, type Browser, type Page } from '@playwright/test';
import type { CreateItemRequest, SharedWishlistResponse } from '@wishlist/contracts';
import { expectAccessible, expectNoSidewaysScroll, PHONE } from '../../support/a11y.js';
import { addItemViaApi, verifiedOwner } from '../../support/owner.js';
import { claimViaApi, guest, shareTokenOf } from '../../support/share.js';

/** Ada's list with one item, and a gifter's page open on it. */
async function setUp(
  page: Page,
  browser: Browser,
  base: string,
  label: string,
  item: Partial<CreateItemRequest> & { title: string } = { title: 'Enamel kettle' },
) {
  await verifiedOwner(page, base, label);
  const added = await addItemViaApi(page.request, base, item);
  const token = await shareTokenOf(page.request);
  const context = await guest(browser, base);
  const gifter = await context.newPage();
  await gifter.goto(`/s/${token}`);
  return { added, token, context, gifter };
}

const card = (page: Page, title: string) =>
  page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: title }) });

async function claimsOn(page: Page, token: string) {
  const shared = (await (
    await page.request.get(`/api/shared/${token}`)
  ).json()) as SharedWishlistResponse;
  return shared.items.flatMap((item) => item.claims ?? []);
}

test('a gifter claims in three taps and keeps the manage link (spec §1 criterion 2)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const { token, gifter } = await setUp(page, browser, base, 'claim-taps');
  await gifter.setViewportSize(PHONE);
  await card(gifter, 'Enamel kettle').getByRole('button', { name: 'I’ll get this' }).click();
  const sheet = gifter.getByRole('dialog', { name: 'Enamel kettle' });
  await expect(sheet.getByLabel('Your name')).toBeFocused();
  await expect(sheet).toContainText('Ada can’t see who’s getting what, so the surprise is safe.');
  await expectAccessible(gifter);
  await sheet.getByLabel('Your name').fill('Aunt Sue');
  await sheet.getByRole('button', { name: 'Claim it' }).click();

  const done = gifter.getByRole('dialog', { name: 'You’re getting Enamel kettle' });
  await expect(done.getByText('Save this link to change or cancel your claim.')).toBeVisible();
  const manageUrl = (await done.getByText(/\/c\/[\w-]{22}$/).textContent()) ?? '';
  // The refresh after a claim drops the streamed <title> for a moment; axe wants it back.
  await expect(gifter).toHaveTitle(/Hanker/);
  await expectAccessible(gifter);
  await expectNoSidewaysScroll(gifter);
  await done.getByRole('button', { name: 'Back to Ada’s list' }).click();

  const kettle = card(gifter, 'Enamel kettle');
  await expect(kettle).toContainText('You’re getting 1');
  await expect(kettle.getByRole('link', { name: /^Change/ })).toHaveAttribute(
    'href',
    new URL(manageUrl).pathname,
  );
  await expect(kettle.getByRole('button', { name: 'I’ll get this' })).toHaveCount(0);
  expect(await claimsOn(gifter, token)).toEqual([
    expect.objectContaining({ claimerName: 'Aunt Sue', quantity: 1 }),
  ]);
});

test('the stepper stops at what is left, and the name is remembered', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const { added, token, gifter } = await setUp(page, browser, base, 'claim-stepper', {
    title: 'Merino socks',
    quantity: 3,
  });
  await claimViaApi((await guest(browser, base)).request, base, token, added.id, {
    claimerName: 'Sam',
  });
  await gifter.reload();
  await card(gifter, 'Merino socks').getByRole('button', { name: 'I’ll get this' }).click();
  const sheet = gifter.getByRole('dialog', { name: 'Merino socks' });
  await expect(sheet).toContainText('Ada wants 3. Sam is getting 1, so 2 are left.');
  await expect(sheet.getByText('Up to 2')).toBeVisible();
  await sheet.getByRole('button', { name: 'More' }).click();
  await expect(sheet.getByRole('group', { name: 'How many' }).locator('output')).toHaveText('2');
  await expect(sheet.getByRole('button', { name: 'More' })).toBeDisabled();
  await sheet.getByLabel('Your name').fill('Priya');
  await sheet.getByRole('button', { name: 'Claim it' }).click();
  await gifter.getByRole('button', { name: 'Back to Ada’s list' }).click();
  await expect(card(gifter, 'Merino socks')).toContainText('You’re getting 2');

  await addItemViaApi(page.request, base, { title: 'Pottery class' });
  await gifter.reload();
  await card(gifter, 'Pottery class').getByRole('button', { name: 'I’ll get this' }).click();
  await expect(gifter.getByRole('dialog').getByLabel('Your name')).toHaveValue('Priya');
});

test('says so when someone else claimed the last one first (spec §7 step 4)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const { added, token, gifter } = await setUp(page, browser, base, 'claim-last');
  await card(gifter, 'Enamel kettle').getByRole('button', { name: 'I’ll get this' }).click();
  await claimViaApi((await guest(browser, base)).request, base, token, added.id, {
    claimerName: 'Sam',
  });
  const sheet = gifter.getByRole('dialog');
  await sheet.getByLabel('Your name').fill('Priya');
  await sheet.getByRole('button', { name: 'Claim it' }).click();
  await expect(sheet.getByRole('alert')).toHaveText('Someone else just claimed the last one.');
  await sheet.getByRole('button', { name: 'Back to the list' }).click();
  await expect(card(gifter, 'Enamel kettle')).toContainText('Taken care of: Sam is getting this');
});

test('resets the stepper when someone else took some first (spec §7 step 4)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const { added, token, gifter } = await setUp(page, browser, base, 'claim-some', {
    title: 'Merino socks',
    quantity: 3,
  });
  await card(gifter, 'Merino socks').getByRole('button', { name: 'I’ll get this' }).click();
  const sheet = gifter.getByRole('dialog');
  await sheet.getByRole('button', { name: 'More' }).click();
  await sheet.getByRole('button', { name: 'More' }).click();
  await claimViaApi((await guest(browser, base)).request, base, token, added.id, {
    claimerName: 'Sam',
    quantity: 2,
  });
  await sheet.getByLabel('Your name').fill('Priya');
  await sheet.getByRole('button', { name: 'Claim it' }).click();
  await expect(sheet.getByRole('alert')).toHaveText(
    'Someone else claimed some while you were choosing, so only 1 is left. We’ve set how many to 1.',
  );
  await expect(sheet.getByRole('group', { name: 'How many' }).locator('output')).toHaveText('1');
  await sheet.getByRole('button', { name: 'Claim the last one' }).click();
  await expect(gifter.getByRole('dialog', { name: 'You’re getting Merino socks' })).toBeVisible();
});

test('a lost answer is found again by Try again, not claimed twice (D42, Review Focus 1)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const { token, gifter } = await setUp(page, browser, base, 'claim-retry');
  let lost = false;
  await gifter.route('**/api/shared/*/items/*/claims', async (route) => {
    if (lost) return route.continue();
    lost = true;
    await route.fetch(); // the API makes the claim…
    await route.abort('internetdisconnected'); // …and its answer never arrives
  });
  await card(gifter, 'Enamel kettle').getByRole('button', { name: 'I’ll get this' }).click();
  const sheet = gifter.getByRole('dialog');
  await sheet.getByLabel('Your name').fill('Priya');
  await sheet.getByRole('button', { name: 'Claim it' }).click();
  await expect(sheet.getByRole('alert')).toContainText('reach Hanker');
  await sheet.getByRole('button', { name: 'Try again' }).click();
  await expect(gifter.getByRole('dialog', { name: 'You’re getting Enamel kettle' })).toBeVisible();
  expect(await claimsOn(gifter, token)).toHaveLength(1);
});

test('a lost answer comes back on reload, with nothing to tap (D42)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const { token, gifter } = await setUp(page, browser, base, 'claim-reload');
  await gifter.route('**/api/shared/*/items/*/claims', async (route) => {
    await route.fetch();
    await route.abort('internetdisconnected');
  });
  await card(gifter, 'Enamel kettle').getByRole('button', { name: 'I’ll get this' }).click();
  await gifter.getByRole('dialog').getByLabel('Your name').fill('Priya');
  await gifter.getByRole('dialog').getByRole('button', { name: 'Claim it' }).click();
  await expect(gifter.getByRole('dialog').getByRole('alert')).toContainText('reach Hanker');
  await gifter.unrouteAll();
  await gifter.reload();
  await expect(card(gifter, 'Enamel kettle')).toContainText('You’re getting 1');
  expect(await claimsOn(gifter, token)).toHaveLength(1);
});

test('a double tap makes one claim (Review Focus 1)', async ({ page, browser, baseURL }) => {
  const base = baseURL ?? '';
  const { token, gifter } = await setUp(page, browser, base, 'claim-double', {
    title: 'Enamel kettle',
    quantity: 3,
  });
  await card(gifter, 'Enamel kettle').getByRole('button', { name: 'I’ll get this' }).click();
  await gifter.getByRole('dialog').getByLabel('Your name').fill('Priya');
  await gifter.getByRole('dialog').getByRole('button', { name: 'Claim it' }).dblclick();
  await expect(gifter.getByRole('dialog', { name: 'You’re getting Enamel kettle' })).toBeVisible();
  expect(await claimsOn(gifter, token)).toHaveLength(1);
});

test('claims without storage, and still hands over the manage link (Review Focus 2)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'claim-nostorage');
  await addItemViaApi(page.request, base, { title: 'Enamel kettle' });
  const token = await shareTokenOf(page.request);
  const context = await guest(browser, base);
  await context.addInitScript(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      get() {
        throw new Error('storage is blocked');
      },
    });
  });
  const gifter = await context.newPage();
  const errors: string[] = [];
  gifter.on('pageerror', (error) => errors.push(error.message));
  await gifter.goto(`/s/${token}`);
  await card(gifter, 'Enamel kettle').getByRole('button', { name: 'I’ll get this' }).click();
  await gifter.getByRole('dialog').getByLabel('Your name').fill('Priya');
  await gifter.getByRole('dialog').getByRole('button', { name: 'Claim it' }).click();
  await expect(gifter.getByText(/\/c\/[\w-]{22}$/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('says when the item was taken off the list while the sheet was open (Review Focus 3)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const { added, gifter } = await setUp(page, browser, base, 'claim-deleted');
  await card(gifter, 'Enamel kettle').getByRole('button', { name: 'I’ll get this' }).click();
  const removed = await page.request.delete(`/api/wishlist/items/${added.id}`, {
    headers: { origin: base },
    data: {},
  });
  expect(removed.status()).toBe(204);
  const sheet = gifter.getByRole('dialog');
  await sheet.getByLabel('Your name').fill('Priya');
  await sheet.getByRole('button', { name: 'Claim it' }).click();
  await expect(sheet.getByRole('alert')).toHaveText('This item was just taken off the list.');
  await sheet.getByRole('button', { name: 'Back to the list' }).click();
  await expect(card(gifter, 'Enamel kettle')).toHaveCount(0);
});

test('lands on the dead-link page when the link was replaced while the sheet was open (Review Focus 3)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const { gifter } = await setUp(page, browser, base, 'claim-rotated');
  await card(gifter, 'Enamel kettle').getByRole('button', { name: 'I’ll get this' }).click();
  await page.request.post('/api/wishlist/share-token/rotate', {
    headers: { origin: base },
    data: {},
  });
  await gifter.getByRole('dialog').getByLabel('Your name').fill('Priya');
  await gifter.getByRole('dialog').getByRole('button', { name: 'Claim it' }).click();
  await expect(
    gifter.getByRole('heading', { level: 1, name: 'This list’s link doesn’t work.' }),
  ).toBeVisible();
});
