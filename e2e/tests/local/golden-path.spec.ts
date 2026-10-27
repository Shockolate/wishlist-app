import { expect, test } from '@playwright/test';
import { PASSWORD, uniqueEmail } from '../../support/accounts.js';
import { linkPath, waitForEmail } from '../../support/mailpit.js';
import { passTurnstile } from '../../support/turnstile.js';

const VERIFY = 'Confirm your email for Hanker';
const RESET = 'Reset your Hanker password';
const NEW_PASSWORD = 'a brand new passphrase 2';

test('a new person signs up, confirms, builds and shares a list, a gifter claims and manages it, the owner sees it, then renames, resets the password and leaves (spec §8)', async ({
  context,
  page,
  browser,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  // Two Turnstile passes and two mail waits can each take 15 s, more than the default 30 s.
  test.slow();
  const email = uniqueEmail('golden');
  const mainNav = page.getByRole('navigation', { name: 'Main' });

  await page.goto('/');
  await page.getByRole('link', { name: 'Create your list' }).click();
  await expect(page).toHaveURL('/signup');
  await page.getByLabel('Your name').fill('Ada');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await passTurnstile(page);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  await page.goto(linkPath((await waitForEmail(email, VERIFY)).text, '/verify-email'));
  await page.getByRole('button', { name: 'Confirm my email' }).click();
  await page.getByRole('link', { name: 'Go to your list' }).click();

  // Signing up doesn't log you in: the list sends you to login, and back.
  await expect(page).toHaveURL('/login?next=%2Flist');
  // Reached by a client-side navigation, so the login page reloads itself (D38). Fill the fresh
  // document, not the one that is about to go. Evaluating in a document that is being replaced
  // throws, which just means the reload has begun.
  await expect
    .poll(() =>
      page
        .evaluate(() => {
          const { performance } = globalThis as unknown as {
            performance: { getEntriesByType(type: string): { name: string }[] };
          };
          return performance.getEntriesByType('navigation')[0]?.name;
        })
        .catch(() => undefined),
    )
    .toContain('/login?next=');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: "Ada's wishlist" })).toBeVisible();
  await expect(page.getByText('Confirm your email to start your list')).toHaveCount(0);

  // Build a list, reorder it, and copy the link to share (spec §8).
  const box = page.getByLabel('Add to your list');
  await box.fill('Pottery class for two');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Add to list' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Added “Pottery class for two”.' }),
  ).toBeVisible();
  await box.fill('Enamel kettle https://hanker-e2e.invalid/kettle');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Enamel kettle');
  await page.getByRole('button', { name: 'Add to list' }).click();
  await page.getByRole('button', { name: 'Move “Enamel kettle” up' }).click();
  await expect(page.getByRole('listitem').first()).toContainText('Enamel kettle');
  await page.getByRole('button', { name: 'Copy share link' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Link copied.' })).toBeVisible();

  // A gifter claims in another browser and changes the claim; the owner chooses to see it.
  const { shareUrl } = (await (await page.request.get('/api/wishlist')).json()) as {
    shareUrl: string;
  };
  const gifterContext = await browser.newContext();
  const gifter = await gifterContext.newPage();
  await gifter.goto(shareUrl);
  await gifter
    .getByRole('listitem')
    .filter({ hasText: 'Enamel kettle' })
    .getByRole('button', { name: 'I’ll get this' })
    .click();
  await gifter.getByRole('dialog').getByLabel('Your name').fill('Aunt Sue');
  await gifter.getByRole('dialog').getByRole('button', { name: 'Claim it' }).click();
  const manageUrl =
    (await gifter
      .getByRole('dialog')
      .getByText(/\/c\/[\w-]{22}$/)
      .textContent()) ?? '';
  await gifter.goto(manageUrl);
  await gifter.getByLabel('Your name').fill('Aunt Susan');
  await gifter.getByRole('button', { name: 'Save changes' }).click();
  await expect(gifter.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  await gifterContext.close();

  await mainNav.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('switch', { name: 'Show how many are claimed' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Show me' }).click();
  await expect(page.getByRole('switch', { name: 'Show how many are claimed' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await mainNav.getByRole('link', { name: 'Your list' }).click();
  const kettleRow = page.getByRole('listitem').filter({ hasText: 'Enamel kettle' });
  await expect(kettleRow).toContainText('Claimed');
  await expect(kettleRow).not.toContainText('Aunt Susan');

  await mainNav.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('Display name').fill('Ada Lovelace');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Name saved' })).toHaveText(
    'Name saved.',
  );

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL('/');
  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  await expect(page).toHaveURL('/reset-password');
  await page.getByLabel('Email').fill(email);
  await passTurnstile(page);
  await page.getByRole('button', { name: 'Send the link' }).click();
  await expect(page.getByRole('status')).toContainText('a link is on its way');

  await page.goto(linkPath((await waitForEmail(email, RESET)).text, '/reset-password/confirm'));
  await page.getByLabel('New password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Save the new password' }).click();
  await page.getByRole('link', { name: 'Go to sign in' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: "Ada's wishlist" })).toBeVisible();

  await mainNav.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Delete account' }).click();
  const deleteDialog = page.getByRole('alertdialog', { name: 'Delete your account?' });
  await deleteDialog.getByLabel('Your password').fill(NEW_PASSWORD);
  await deleteDialog.getByRole('button', { name: 'Delete account' }).click();
  await expect(page).toHaveURL('/');
});
