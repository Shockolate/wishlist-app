import { expect, test, type Browser, type Page, type Request } from '@playwright/test';
import type { GiftsResponse } from '@wishlist/contracts';
import { expectAccessible, expectNoSidewaysScroll, PHONE } from '../../support/a11y.js';
import { logInViaApi } from '../../support/accounts.js';
import { addItemViaApi, verifiedOwner } from '../../support/owner.js';
import { claimViaApi, guest, shareTokenOf } from '../../support/share.js';

/** A verified account in its own browser, so each person has their own session. */
async function person(browser: Browser, base: string, label: string, displayName: string) {
  const context = await browser.newContext({ baseURL: base });
  const page = await context.newPage();
  const email = await verifiedOwner(page, base, label, displayName);
  return { page, email };
}

/** Ada's list with one item; returns what a gifter needs to claim it. */
async function listWithItem(browser: Browser, base: string, label: string) {
  const { page: mom } = await person(browser, base, label, 'Mom');
  const item = await addItemViaApi(mom.request, base, { title: 'Enamel kettle' });
  return { mom, item, shareToken: await shareTokenOf(mom.request) };
}

/** A claim made by a guest, as when the manage link was texted to someone. */
async function guestClaim(
  browser: Browser,
  base: string,
  shareToken: string,
  itemId: string,
  claimerName = 'Grandma',
) {
  const context = await guest(browser, base);
  return claimViaApi(context.request, base, shareToken, itemId, { claimerName });
}

const titles = async (page: Page) => {
  const res = await page.request.get('/api/me/gifts');
  expect(res.status()).toBe(200);
  return ((await res.json()) as GiftsResponse).gifts.map((gift) => gift.item.title);
};

const linkRequests = (page: Page) => {
  const seen: string[] = [];
  page.on('request', (request: Request) => {
    if (/\/api\/claims\/[^/]+\/link$/.test(request.url())) {
      seen.push(`${request.method()} ${request.url()}`);
    }
  });
  return seen;
};

/** The page's storage: this project's E2E code is typed without the DOM. Callbacks run in the browser, so each reads `globalThis` itself. */
type PageStorage = { localStorage: Storage; sessionStorage: Storage };
interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KETTLE = 'Enamel kettle';
const SOMEONE_ELSE =
  'Another Hanker account is already keeping track of this claim. You can still change or cancel it here.';

test('signed in, the sheet prefills my display name, says where the claim goes, and links to Your gifts after', async ({
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const { item, shareToken } = await listWithItem(browser, base, 'sic-sheet-mom');
  const { page: gina } = await person(browser, base, 'sic-sheet-gina', 'Gina');
  // A name this browser used before: the account's display name wins while signed in.
  await gina.addInitScript(() => {
    const w = globalThis as unknown as PageStorage;
    if (!w.sessionStorage.getItem('seeded')) {
      w.sessionStorage.setItem('seeded', '1');
      w.localStorage.setItem('hanker:claimerName', 'Old name');
    }
  });
  await gina.goto(`/s/${shareToken}`);
  await gina
    .getByRole('listitem')
    .filter({ hasText: KETTLE })
    .getByRole('button', { name: 'I’ll get this' })
    .click();
  const sheet = gina.getByRole('dialog', { name: KETTLE });
  await expect(sheet.getByLabel('Your name')).toHaveValue('Gina');
  await expect(
    sheet.getByText('You’ll also find this on Your gifts.', { exact: true }),
  ).toBeVisible();
  await gina.setViewportSize(PHONE);
  await expectNoSidewaysScroll(gina);
  await expectAccessible(gina);

  // The gifter can still change it ("Grandma").
  await sheet.getByLabel('Your name').fill('Grandma');
  await sheet.getByRole('button', { name: 'Claim it' }).click();
  const done = gina.getByRole('dialog', { name: `You’re getting ${KETTLE}` });
  // The manage link is still handed over, and so is the way to Your gifts.
  await expect(done.getByText('Save this link to change or cancel your claim.')).toBeVisible();
  const seeGifts = done.getByRole('link', { name: 'See Your gifts' });
  await expect(seeGifts).toHaveAttribute('href', '/gifts');
  await expectAccessible(gina);
  // The sheet still writes the name and the claim record first (D42, D45).
  const stored = await gina.evaluate(() => {
    const w = globalThis as unknown as PageStorage;
    return {
      name: w.localStorage.getItem('hanker:claimerName'),
      claims: w.localStorage.getItem('hanker:claims'),
    };
  });
  expect(stored.name).toBe('Grandma');
  expect(stored.claims).toContain(item.id);

  await seeGifts.click();
  await expect(gina).toHaveURL('/gifts');
  await expect(gina.getByRole('heading', { level: 3, name: KETTLE })).toBeVisible();
  expect(await titles(gina)).toEqual([KETTLE]);
});

test('opening my manage link signed in adds the claim, and Not mine takes it off', async ({
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const { item, shareToken } = await listWithItem(browser, base, 'sic-open-mom');
  const { manageToken } = await guestClaim(browser, base, shareToken, item.id);

  // Opening the page changes nothing: with no script to send the request, nothing is linked.
  const { page: noScript, email } = await person(browser, base, 'sic-open-nojs', 'Nina');
  const bare = await browser.newContext({ baseURL: base, javaScriptEnabled: false });
  expect(await logInViaApi(bare.request, base, email)).toBe(204);
  const plain = await bare.newPage();
  await plain.goto(`/c/${manageToken}`);
  await expect(plain.getByRole('heading', { level: 1, name: 'Your claim' })).toBeVisible();
  await expect(plain.getByText('Added to Your gifts.')).toHaveCount(0);
  expect(await titles(noScript)).toEqual([]);

  // A shared tablet: Grandma opens her link where Mum is signed in.
  const { page: mum } = await person(browser, base, 'sic-open-mum', 'Mum');
  await mum.goto(`/c/${manageToken}`);
  const added = mum.getByRole('status').filter({ hasText: 'Added to Your gifts.' });
  await expect(added).toBeVisible();
  await expect(added.getByRole('link', { name: 'Your gifts' })).toHaveAttribute('href', '/gifts');
  await expect(mum.getByRole('heading', { level: 1, name: 'Your claim' })).toBeVisible();
  await expectAccessible(mum);
  expect(await titles(mum)).toEqual([KETTLE]);

  await added.getByRole('button', { name: 'Not mine' }).click();
  const taken = mum
    .getByRole('status')
    .filter({ hasText: 'This claim is no longer on Your gifts.' });
  await expect(taken).toBeVisible();
  await expect(mum.getByRole('button', { name: 'Not mine' })).toHaveCount(0);
  await expectAccessible(mum);
  expect(await titles(mum)).toEqual([]);
  // Not mine leaves the claim alone.
  await expect(mum.getByRole('button', { name: 'Cancel my claim' })).toBeVisible();
  const details = await mum.request.get(`/api/claims/${manageToken}`);
  expect(details.status()).toBe(200);
  expect(await details.json()).toMatchObject({
    claim: { claimerName: 'Grandma', quantity: 1 },
    link: 'none',
  });

  // Grandma's own account can now link it (Review Focus 2).
  const { page: grandma } = await person(browser, base, 'sic-open-grandma', 'Grandma');
  await grandma.goto(`/c/${manageToken}`);
  await expect(
    grandma.getByRole('status').filter({ hasText: 'Added to Your gifts.' }),
  ).toBeVisible();
  expect(await titles(grandma)).toEqual([KETTLE]);
  expect(await titles(mum)).toEqual([]);
});

test('a manage link already on someone else’s gifts says so, and still changes the claim; its holder can take it off', async ({
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const { item, shareToken } = await listWithItem(browser, base, 'sic-else-mom');
  const { manageToken } = await guestClaim(browser, base, shareToken, item.id);
  const { page: first } = await person(browser, base, 'sic-else-first', 'Margaret');
  const linked = await first.request.post(`/api/claims/${manageToken}/link`, {
    headers: { origin: base },
    data: {},
  });
  expect(await linked.json()).toEqual({ link: 'yours' });

  const { page: partner } = await person(browser, base, 'sic-else-partner', 'Pat');
  const requests = linkRequests(partner);
  await partner.goto(`/c/${manageToken}`);
  const notice = partner.getByText(SOMEONE_ELSE, { exact: true });
  await expect(notice).toBeVisible();
  await expect(partner.getByText('Added to Your gifts.')).toHaveCount(0);
  await expect(partner.getByRole('button', { name: 'Not mine' })).toHaveCount(0);
  await expectAccessible(partner);
  // The page asked for nothing: it was already linked, to the first account.
  expect(requests).toEqual([]);
  expect(await titles(partner)).toEqual([]);

  // The link keeps all its powers.
  await partner.getByLabel('Your name').fill('Grandma K');
  await partner.getByRole('button', { name: 'Save changes' }).click();
  await expect(partner.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  expect(await titles(first)).toEqual([KETTLE]);
  const details = await first.request.get(`/api/claims/${manageToken}`);
  expect(await details.json()).toMatchObject({
    claim: { claimerName: 'Grandma K' },
    link: 'yours',
  });

  // The account that holds it is told so, and Not mine takes it off from here too (R12).
  const firstRequests = linkRequests(first);
  await first.goto(`/c/${manageToken}`);
  await expect(first.getByRole('heading', { level: 1, name: 'Your claim' })).toBeVisible();
  const onGifts = first.getByRole('status').filter({ hasText: 'This claim is on Your gifts.' });
  await expect(onGifts).toBeVisible();
  await expect(onGifts.getByRole('link', { name: 'Your gifts' })).toHaveAttribute('href', '/gifts');
  await expect(first.getByText('Added to Your gifts.')).toHaveCount(0);
  await expect(first.getByText(SOMEONE_ELSE, { exact: true })).toHaveCount(0);
  await expectAccessible(first);
  // Already linked: loading the page asked for nothing.
  expect(firstRequests).toEqual([]);

  await onGifts.getByRole('button', { name: 'Not mine' }).click();
  await expect(
    first.getByRole('status').filter({ hasText: 'This claim is no longer on Your gifts.' }),
  ).toBeVisible();
  await expect(first.getByRole('button', { name: 'Not mine' })).toHaveCount(0);
  await expectAccessible(first);
  expect(firstRequests).toEqual([expect.stringMatching(/^DELETE .*\/link$/)]);
  expect(await titles(first)).toEqual([]);
  // The claim is unchanged; it's only off Your gifts.
  const after = await first.request.get(`/api/claims/${manageToken}`);
  expect(await after.json()).toMatchObject({
    claim: { claimerName: 'Grandma K', quantity: 1 },
    link: 'none',
  });

  // Not mine sticks for the life of the page: a save refreshes it, and the refreshed page now says
  // `none`, but this page opened on `yours`, so it must not link again.
  const refreshed = first.waitForResponse(
    (response) => response.url().includes(`/c/${manageToken}`) && response.url().includes('_rsc='),
  );
  await first.getByLabel('Your name').fill('Grandma M');
  await first.getByRole('button', { name: 'Save changes' }).click();
  await expect(first.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  await refreshed;
  // The refreshed page renders and its effects run a beat after the response lands.
  await first.waitForTimeout(500);
  expect(firstRequests).toEqual([expect.stringMatching(/^DELETE .*\/link$/)]);
  expect(await titles(first)).toEqual([]);
  await expect(
    first.getByRole('status').filter({ hasText: 'This claim is no longer on Your gifts.' }),
  ).toBeVisible();
  await expect(first.getByText('Added to Your gifts.')).toHaveCount(0);
});

test('a guest’s sheet and /c are unchanged', async ({ browser, baseURL }) => {
  const base = baseURL ?? '';
  const { shareToken, mom } = await listWithItem(browser, base, 'sic-guest-mom');
  const visitor = await (await guest(browser, base)).newPage();
  await visitor.addInitScript(() => {
    (globalThis as unknown as PageStorage).localStorage.setItem('hanker:claimerName', 'Aunt Sue');
  });
  const requests = linkRequests(visitor);
  await visitor.goto(`/s/${shareToken}`);
  await visitor
    .getByRole('listitem')
    .filter({ hasText: KETTLE })
    .getByRole('button', { name: 'I’ll get this' })
    .click();
  const sheet = visitor.getByRole('dialog', { name: KETTLE });
  // The name comes from this browser's memory, as before, and the sheet says nothing of gifts.
  await expect(sheet.getByLabel('Your name')).toHaveValue('Aunt Sue');
  await expect(sheet.getByText(/Your gifts/)).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Claim it' }).click();
  const done = visitor.getByRole('dialog', { name: `You’re getting ${KETTLE}` });
  await expect(done.getByText('Save this link to change or cancel your claim.')).toBeVisible();
  await expect(done.getByText(/Your gifts/)).toHaveCount(0);
  await expect(done.getByRole('link', { name: 'See Your gifts' })).toHaveCount(0);
  const manageUrl = (await done.getByText(/\/c\/[\w-]{22}$/).textContent()) ?? '';

  await visitor.goto(new URL(manageUrl).pathname);
  await expect(visitor.getByRole('heading', { level: 1, name: 'Your claim' })).toBeVisible();
  await expect(visitor.getByLabel('Your name')).toHaveValue('Aunt Sue');
  await expect(visitor.getByText(/Your gifts/)).toHaveCount(0);
  await expect(visitor.getByRole('button', { name: 'Not mine' })).toHaveCount(0);
  expect(requests).toEqual([]);

  // The owner, signed in, sees the hidden view and no link is asked for.
  const ownRequests = linkRequests(mom);
  await mom.goto(new URL(manageUrl).pathname);
  await expect(mom.getByText(/Hanker keeps it hidden from you/)).toBeVisible();
  await expect(mom.getByText(/Your gifts/)).toHaveCount(0);
  expect(ownRequests).toEqual([]);
});
