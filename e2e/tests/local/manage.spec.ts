import { expect, test, type Browser, type Page } from '@playwright/test';
import type { ClaimDetailsResponse, CreateItemRequest } from '@wishlist/contracts';
import { expectAccessible, expectFitsPhone } from '../../support/a11y.js';
import { addItemViaApi, verifiedOwner } from '../../support/owner.js';
import { claimViaApi, guest, shareTokenOf } from '../../support/share.js';

/** Ada's list with one item that Priya has claimed one of, and Priya's browser. */
async function claimed(
  page: Page,
  browser: Browser,
  base: string,
  label: string,
  item: Partial<CreateItemRequest> & { title: string } = { title: 'Merino socks', quantity: 3 },
) {
  await verifiedOwner(page, base, label);
  const added = await addItemViaApi(page.request, base, item);
  const token = await shareTokenOf(page.request);
  const context = await guest(browser, base);
  const { manageToken } = await claimViaApi(context.request, base, token, added.id, {
    claimerName: 'Priya',
  });
  return { added, token, manageToken, context, gifter: await context.newPage() };
}

async function detailsOf(page: Page, manageToken: string) {
  return (await (
    await page.request.get(`/api/claims/${manageToken}`)
  ).json()) as ClaimDetailsResponse;
}

test('shows the claim, and saves a new name and quantity (spec §2)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const { manageToken, gifter } = await claimed(page, browser, base, 'manage-change', {
    title: 'Merino socks',
    quantity: 3,
    priceText: '$24.00',
    url: 'https://trailpost.example/socks',
  });
  const res = await gifter.goto(`/c/${manageToken}`);
  expect(res?.headers()['referrer-policy']).toBe('no-referrer');
  expect(res?.headers()['x-robots-tag']).toBe('noindex');
  await expect(gifter).toHaveTitle('Your claim | Hanker');
  await expect(gifter.getByRole('heading', { level: 1, name: 'Your claim' })).toBeVisible();
  await expect(gifter.getByRole('link', { name: "Ada's wishlist" })).toBeVisible();
  await expect(gifter.getByText('You’re getting 1 of the 3 Ada wants')).toBeVisible();
  await expect(gifter.getByText('Up to 3, with 2 still unclaimed')).toBeVisible();
  await expect(
    gifter.getByText('Ada can’t see who’s getting what, so the surprise is safe.'),
  ).toBeVisible();
  await expectAccessible(gifter);

  await gifter.getByLabel('Your name').fill('Priya K');
  await gifter.getByRole('button', { name: 'More' }).click();
  await gifter.getByRole('button', { name: 'Save changes' }).click();
  await expect(gifter.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  await expect(gifter.getByText('You’re getting 2 of the 3 Ada wants')).toBeVisible();
  expect((await detailsOf(gifter, manageToken)).claim).toMatchObject({
    claimerName: 'Priya K',
    quantity: 2,
  });
  await expectFitsPhone(gifter, `/c/${manageToken}`);
});

test('raising past what is left says so, and sets the most (spec §2)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const { added, token, manageToken, gifter } = await claimed(page, browser, base, 'manage-409');
  await gifter.goto(`/c/${manageToken}`);
  await gifter.getByRole('button', { name: 'More' }).click();
  await gifter.getByRole('button', { name: 'More' }).click();
  await claimViaApi((await guest(browser, base)).request, base, token, added.id, {
    claimerName: 'Sam',
  });
  await gifter.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    gifter.getByRole('alert').filter({ hasText: 'Someone else claimed some' }),
  ).toHaveText('Someone else claimed some, so you can have up to 2 now. We’ve set how many to 2.');
  await expect(gifter.getByRole('group', { name: 'How many' }).locator('output')).toHaveText('2');
});

test('cancelling asks first, then the link stops working (spec §2)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const { token, manageToken, gifter } = await claimed(page, browser, base, 'manage-cancel');
  await gifter.goto(`/c/${manageToken}`);
  await gifter.getByRole('button', { name: 'Cancel my claim' }).click();
  const dialog = gifter.getByRole('alertdialog', { name: 'Cancel your claim?' });
  await expect(dialog).toContainText('Merino socks goes back on the list for someone else.');
  await dialog.getByRole('button', { name: 'Keep my claim' }).click();
  await expect(gifter.getByRole('heading', { level: 1, name: 'Your claim' })).toBeVisible();

  await gifter.getByRole('button', { name: 'Cancel my claim' }).click();
  await gifter.getByRole('alertdialog').getByRole('button', { name: 'Cancel claim' }).click();
  await expect(
    gifter.getByRole('heading', { level: 1, name: 'Your claim is cancelled.' }),
  ).toBeFocused();
  await expectAccessible(gifter);
  await gifter.getByRole('link', { name: "Back to Ada's wishlist" }).click();
  await expect(gifter).toHaveURL(`/s/${token}`);
  await expect(gifter.getByText('Priya')).toHaveCount(0);

  const res = await gifter.goto(`/c/${manageToken}`);
  expect(res?.status()).toBe(404);
  await expect(
    gifter.getByRole('heading', { level: 1, name: 'This claim no longer exists.' }),
  ).toBeVisible();
});

test('opening the manage link on another device puts the claim on that device’s share page (D45)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const { token, manageToken } = await claimed(page, browser, base, 'manage-device');
  const laptop = await (await guest(browser, base)).newPage();
  await laptop.goto(`/c/${manageToken}`);
  await expect(laptop.getByRole('heading', { level: 1, name: 'Your claim' })).toBeVisible();
  await laptop.goto(`/s/${token}`);
  await expect(laptop.getByRole('listitem').first()).toContainText('You’re getting 1');
});

test('the owner opening a claim’s link on their own list sees it’s hidden, and nothing about it (D82)', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'manage-own-list');
  const added = await addItemViaApi(page.request, base, { title: 'Merino socks', quantity: 3 });
  const token = await shareTokenOf(page.request);
  const signedOut = await guest(browser, base);
  const { manageToken } = await claimViaApi(signedOut.request, base, token, added.id, {
    claimerName: 'Sue',
  });

  await page.goto(`/c/${manageToken}`);
  const main = page.getByRole('main');
  await expect(page.getByRole('heading', { level: 1, name: 'Your claim' })).toBeVisible();
  await expect(
    main.getByText(
      'This link is for a claim on your own list, so Hanker keeps it hidden from you.',
    ),
  ).toBeVisible();
  await expect(main.getByRole('link', { name: 'Back to your list' })).toHaveAttribute(
    'href',
    '/list',
  );
  await expect(main).not.toContainText('Sue');
  await expect(main).not.toContainText('Merino socks');
  await expect(main.getByRole('button')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('hanker:claims'))).toBeNull();
  await expectAccessible(page);

  // Signed out, the same link is the gifter's own claim, as ever.
  const gifter = await signedOut.newPage();
  await gifter.goto(`/c/${manageToken}`);
  await expect(gifter.getByLabel('Your name')).toHaveValue('Sue');
  await expect(gifter.getByRole('button', { name: 'Cancel my claim' })).toBeVisible();
});

test('a dead or mangled manage link gets the gone page with a 404', async ({
  browser,
  baseURL,
}) => {
  const visitor = await (await guest(browser, baseURL ?? '')).newPage();
  for (const path of ['/c/abcdefghijklmnopqrstuv', '/c/nope']) {
    const res = await visitor.goto(path);
    expect(res?.status(), path).toBe(404);
    await expect(
      visitor.getByRole('heading', { level: 1, name: 'This claim no longer exists.' }),
    ).toBeVisible();
  }
  await expectAccessible(visitor);
});
