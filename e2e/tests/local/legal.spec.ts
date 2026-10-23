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

test('/privacy says what tag suggestions send to Cloudflare (tag suggestions §5.6)', async ({
  page,
}) => {
  await page.goto('/privacy');
  const main = page.getByRole('main');
  // tag-suggest.service.ts sends the title, note, link host, unfurl description and the list's tag
  // names, and nothing else. The Settings card for it is "Tag suggestions".
  await expect(main).toContainText(
    'Unless you turn it off in Settings, Hanker sends an item’s title, note, the shop’s web address (not the full link) and the shop’s product description, with your list’s tag names, to Cloudflare’s AI to suggest tags for it.',
  );
  await expect(main).toContainText(
    'Cloudflare’s AI reads the title and note of items you add or edit, the shop’s web address and product description, and your list’s tag names, to suggest tags. It isn’t told who you are, doesn’t keep what it reads, and doesn’t train on it. You can turn this off in Settings.',
  );
});

test('/terms covers tag suggestions (tag suggestions §5.6)', async ({ page }) => {
  await page.goto('/terms');
  const main = page.getByRole('main');
  await expect(main).toContainText(
    'You give Hanker only the right to store it, show it to anyone with your link, and, unless you turn tag suggestions off, send an item’s details to Cloudflare to suggest tags.',
  );
  await expect(main.getByRole('heading', { name: 'Suggested tags' })).toBeVisible();
  await expect(main).toContainText(
    'Tag suggestions are written by an AI model and can be wrong or odd. They’re only suggestions: nothing is tagged unless you tap it.',
  );
});
