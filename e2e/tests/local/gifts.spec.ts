import { expect, test, type Browser, type Page } from '@playwright/test';
import { expectAccessible, expectNoSidewaysScroll, PHONE } from '../../support/a11y.js';
import { logInViaApi, signUpViaApi, uniqueEmail } from '../../support/accounts.js';
import { addItemViaApi, verifiedOwner } from '../../support/owner.js';
import { claimViaApi, guest, shareTokenOf } from '../../support/share.js';

/** A verified account in its own browser, so each person has their own session. */
async function person(browser: Browser, base: string, label: string, displayName: string) {
  const context = await browser.newContext({ baseURL: base });
  const page = await context.newPage();
  await verifiedOwner(page, base, label, displayName);
  return page;
}

const card = (page: Page, title: string) =>
  page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: title }) });
const group = (page: Page, owner: string) => page.getByRole('region', { name: owner, exact: true });

test('a signed-in gifter’s claims appear on Your gifts, grouped by person, and Bought is ticked privately', async ({
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const mom = await person(browser, base, 'gifts-mom', 'Mom');
  const kettle = await addItemViaApi(mom.request, base, {
    title: 'Fellow Stagg kettle',
    priceText: '$165.00',
    note: 'The matte black one, please.',
  });
  const spatulas = await addItemViaApi(mom.request, base, { title: 'Spatula set' });
  const momToken = await shareTokenOf(mom.request);

  const sam = await person(browser, base, 'gifts-sam', 'Sam');
  const chalk = await addItemViaApi(sam.request, base, { title: 'Chalk bag', quantity: 3 });
  const samToken = await shareTokenOf(sam.request);

  const gifter = await person(browser, base, 'gifts-gifter', 'Gina');
  // Sam first, then Mom, so the groups follow the order of the claims, not of the lists.
  await claimViaApi(gifter.request, base, samToken, chalk.id, { claimerName: 'Gina', quantity: 2 });
  await claimViaApi(gifter.request, base, momToken, kettle.id, { claimerName: 'Gina' });
  await claimViaApi(gifter.request, base, momToken, spatulas.id, { claimerName: 'Gina' });

  await gifter.goto('/list');
  await gifter
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Your gifts' })
    .click();
  await expect(gifter).toHaveURL('/gifts');
  await expect(gifter).toHaveTitle('Your gifts | Hanker');
  await expect(gifter.getByRole('heading', { level: 1, name: 'Your gifts' })).toBeVisible();
  await expect(gifter.getByText('3 things for 2 people', { exact: true })).toBeVisible();

  await expect(gifter.getByRole('heading', { level: 2 })).toHaveText(['Sam', 'Mom']);
  await expect(card(gifter, 'Chalk bag')).toContainText('You’re getting 2');
  await expect(card(gifter, 'Fellow Stagg kettle')).toContainText('$165.00 · you’re getting 1');
  await expect(card(gifter, 'Fellow Stagg kettle')).toContainText('The matte black one, please.');
  await expect(group(gifter, 'Mom').getByRole('listitem').getByRole('heading')).toHaveText([
    'Fellow Stagg kettle',
    'Spatula set',
  ]);
  await expect(group(gifter, 'Mom').getByRole('link', { name: /^Open list/ })).toHaveAttribute(
    'href',
    `${new URL(base).origin}/s/${momToken}`,
  );
  // An idea has no link to shop at.
  await expect(card(gifter, 'Chalk bag').getByRole('link', { name: /^Shop/ })).toHaveCount(0);

  await expectAccessible(gifter);
  await gifter.setViewportSize(PHONE);
  await expectNoSidewaysScroll(gifter);

  const bought = card(gifter, 'Spatula set').getByRole('checkbox', { name: 'Bought' });
  await expect(bought).not.toBeChecked();
  await bought.check();
  await expect(bought).toBeChecked();
  await expect(gifter.getByText('3 things for 2 people · 1 bought', { exact: true })).toBeVisible();
  await gifter.reload();
  await expect(card(gifter, 'Spatula set').getByRole('checkbox', { name: 'Bought' })).toBeChecked();
  await expect(
    card(gifter, 'Fellow Stagg kettle').getByRole('checkbox', { name: 'Bought' }),
  ).not.toBeChecked();
  await expectAccessible(gifter);

  // Bought is the gifter's alone: a guest's view of Mom's list shows nothing of it.
  const visitor = await (await guest(browser, base)).newPage();
  await visitor.goto(`/s/${momToken}`);
  await expect(visitor.getByRole('heading', { name: 'Spatula set' })).toBeVisible();
  await expect(visitor.getByText(/bought/i)).toHaveCount(0);
  const shared = await visitor.request.get(`/api/shared/${momToken}`);
  expect(await shared.text()).not.toMatch(/bought|linkId/i);
  // Nor does Mom's own list.
  expect(await (await mom.request.get('/api/wishlist')).text()).not.toMatch(/bought|linkId/i);
});

test('Shop opens the item’s link safely, and a removed claim is a note the gifter can Clear', async ({
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const sam = await person(browser, base, 'gifts-note-sam', 'Sam');
  const lamp = await addItemViaApi(sam.request, base, {
    title: 'Desk lamp',
    url: 'https://example.com/lamp',
  });
  const bonsai = await addItemViaApi(sam.request, base, { title: 'Botanical bonsai' });
  const samToken = await shareTokenOf(sam.request);
  const gifter = await person(browser, base, 'gifts-note-gifter', 'Gina');
  await claimViaApi(gifter.request, base, samToken, lamp.id, { claimerName: 'Gina' });
  await claimViaApi(gifter.request, base, samToken, bonsai.id, { claimerName: 'Gina' });

  await gifter.goto('/gifts');
  const shop = card(gifter, 'Desk lamp').getByRole('link', { name: /^Shop/ });
  await expect(shop).toHaveAttribute('href', 'https://example.com/lamp');
  await expect(shop).toHaveAttribute('target', '_blank');
  await expect(shop).toHaveAttribute('rel', 'noopener noreferrer');

  // Sam takes the bonsai off their list while Gina has the page open.
  const deleted = await sam.request.delete(`/api/wishlist/items/${bonsai.id}`, {
    headers: { origin: base },
    data: {},
  });
  expect(deleted.status()).toBe(204);
  await gifter.reload();
  const note = gifter.getByRole('listitem').filter({ hasText: 'Botanical bonsai' });
  await expect(note).toContainText('Sam took this off their list. Your claim is gone.');
  await expect(note.getByRole('checkbox')).toHaveCount(0);
  await expectAccessible(gifter);

  await note.getByRole('button', { name: /^Clear/ }).click();
  await expect(gifter.getByText('Botanical bonsai')).toHaveCount(0);
  await gifter.reload();
  await expect(gifter.getByText('Botanical bonsai')).toHaveCount(0);
  await expect(card(gifter, 'Desk lamp')).toBeVisible();
});

test('says what Your gifts is for until there is something on it', async ({ browser, baseURL }) => {
  const gifter = await person(browser, baseURL ?? '', 'gifts-empty', 'Gina');
  await gifter.goto('/gifts');
  await expect(
    gifter.getByText(
      'Nothing here yet. Claims you make while signed in appear here, and so does a claim whose link you open while signed in.',
    ),
  ).toBeVisible();
  await expectAccessible(gifter);
});

test('an unconfirmed email is asked to confirm before seeing gifts', async ({ page, baseURL }) => {
  const base = baseURL ?? '';
  const email = uniqueEmail('gifts-unverified');
  await signUpViaApi(page.request, base, email);
  expect(await logInViaApi(page.request, base, email)).toBe(204);
  await page.goto('/gifts');
  await expect(page.getByRole('status')).toContainText('Confirm your email to see your gifts.');
  await expect(page.getByRole('link', { name: 'send a new link' })).toBeVisible();
  await expectAccessible(page);
});

test('a signed-out visitor is sent to log in and comes back to Your gifts', async ({ page }) => {
  await page.goto('/gifts');
  await expect(page).toHaveURL('/login?next=%2Fgifts');
});

test('Your gifts is kept out of Referer and search results', async ({ page, baseURL }) => {
  const base = baseURL ?? '';
  const email = uniqueEmail('gifts-headers');
  await signUpViaApi(page.request, base, email);
  expect(await logInViaApi(page.request, base, email)).toBe(204);
  const response = await page.goto('/gifts');
  expect(response?.headers()['referrer-policy']).toBe('no-referrer');
  expect(response?.headers()['x-robots-tag']).toBe('noindex');
});
