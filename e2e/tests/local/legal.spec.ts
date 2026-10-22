import { expect, test } from '@playwright/test';

test('/privacy names who runs Hanker and how to reach them', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page).toHaveTitle('Privacy | Hanker');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Privacy');
  const main = page.getByRole('main');
  await expect(main).toContainText('Ted Armstrong');
  await expect(main).toContainText('Portland, Maine');
  await expect(main.getByRole('link', { name: 'hello@hanker.dev' }).first()).toHaveAttribute(
    'href',
    'mailto:hello@hanker.dev',
  );
});

test('/terms says who may use Hanker', async ({ page }) => {
  await page.goto('/terms');
  await expect(page).toHaveTitle('Terms | Hanker');
  const main = page.getByRole('main');
  await expect(main).toContainText('13 and older');
  await expect(main).toContainText('Maine law');
});

test('/privacy matches what the code keeps, where and for how long (final review)', async ({
  page,
}) => {
  await page.goto('/privacy');
  const main = page.getByRole('main');
  // claim-records.ts keeps the gifter's name under hanker:claimerName.
  await expect(main).toContainText('the name you last claimed with');
  // cleanup.service.ts deletes windows that started over a day ago, once a day.
  await expect(main).toContainText('deletes those counts within two days');
  await expect(main).not.toContainText('when its time window ends');
  // EmailLinkForm renders Turnstile on reset-password and resend-verification too.
  await expect(main).toContainText('email-link requests');
  // routing-metadata-fetcher.ts sends Amazon product links to Bright Data, as /dp/<ASIN> only.
  await expect(main).toContainText('Bright Data looks up Amazon product links');
  await expect(main).toContainText('sends only the product’s ID');
  // routing-metadata-fetcher.ts sends Etsy listing links to Etsy's Open API, as the listing ID only.
  await expect(main).toContainText('Etsy looks up Etsy listing links');
});

test('/terms carries Etsy’s trademark statement, verbatim (retailer lookups §5.7)', async ({
  page,
}) => {
  await page.goto('/terms');
  await expect(page.getByRole('main')).toContainText(
    "The term 'Etsy' is a trademark of Etsy, Inc. This Application uses Etsy's API, but is not endorsed or certified by Etsy.",
  );
});
