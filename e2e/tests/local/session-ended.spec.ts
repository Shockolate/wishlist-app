import { expect, test } from '@playwright/test';
import { logInViaApi, PASSWORD } from '../../support/accounts.js';
import { addItemViaApi, verifiedOwner } from '../../support/owner.js';

test('after the session ends on another device, Back from login can’t show signed-in pages (D38)', async ({
  browser,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const phone = await browser.newContext({ baseURL: base });
  const page = await phone.newPage();
  const email = await verifiedOwner(page, base, 'ended');
  await addItemViaApi(page.request, base, { title: 'Kettle' });
  await page.goto('/list');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();

  // A password change on another device ends every other session (spec §6.1).
  const laptop = await browser.newContext({ baseURL: base });
  expect(await logInViaApi(laptop.request, base, email)).toBe(204);
  const changed = await laptop.request.post('/api/me/password', {
    headers: { origin: base },
    data: { currentPassword: PASSWORD, newPassword: 'a brand new passphrase 2' },
  });
  expect(changed.status()).toBe(204);

  // The phone's next client-side navigation finds its session gone, and lands on login.
  await nav.getByRole('link', { name: 'Your list' }).click();
  await expect(page).toHaveURL('/login?next=%2Flist');
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();

  await page.goBack();
  await expect(page.getByText(`Signed in as ${email}`)).toBeHidden();
  await expect(page).toHaveURL('/login?next=%2Fsettings');
  await laptop.close();
  await phone.close();
});
