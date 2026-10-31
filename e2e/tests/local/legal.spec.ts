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
  // routing-metadata-fetcher.ts sends eBay item links to eBay's Browse API, as the item number (and the option's) only.
  await expect(main).toContainText('For Amazon, Etsy and eBay product links');
  await expect(main).toContainText('eBay looks up eBay item links');
  await expect(main).toContainText('and the option’s when the link names one');
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

test('/privacy says what Your gifts keeps (Your gifts §5.11)', async ({ page }) => {
  await page.goto('/privacy');
  const main = page.getByRole('main');
  await expect(
    main.getByRole('heading', { name: 'If you’re signed in when you claim' }),
  ).toBeVisible();
  // claim_links links a claim on a verified session's claim, or its manage link opened after load.
  await expect(main).toContainText('open a claim’s link while signed in and the page has loaded');
  // claim_links.bought_at is in no owner or gifter response.
  await expect(main).toContainText('Bought ticks are stored and seen only by you.');
  // The daily cron deletes notes 30 days after claim_links.gone_at.
  await expect(main).toContainText('on Your gifts for about 30 days, or until you clear it');
  // user_id cascades; claim_id is SET NULL, so a claim outlives the link.
  await expect(main).toContainText('Deleting your account deletes these links, ticks and notes.');
  // No response says which account holds a claim (D75, D82).
  await expect(main).toContainText(
    'Hanker never shows anyone else whose gifts a claim is on, whether they own the list or are another gifter.',
  );
  // An owner's account delete cascades to the claims, but each gifter's link keeps the snapshot
  // of item_title and owner_display_name until the cron purges it (D79, D80).
  await expect(main).toContainText(
    'A gifter who had one of your items on Your gifts keeps a note with its title and your display name for about 30 days, or until they clear it.',
  );
});

test('/privacy says what drawing a share link’s preview fetches and keeps (share link previews §7)', async ({
  page,
}) => {
  await page.goto('/privacy');
  // The preview route asks the API for the photos of up to PREVIEW_CANDIDATES items at once, draws
  // at most PREVIEW_PHOTOS of them, and stores none.
  await expect(page.getByRole('main')).toContainText(
    'When you share your list’s link, Hanker’s server fetches photos of up to eight of your items from the shops to draw up to four in the link’s preview picture, and keeps none of them. Apps that show the preview, like Messages, Slack or Discord, keep their own copy.',
  );
});
