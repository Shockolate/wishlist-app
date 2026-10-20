import { expect, test } from '@playwright/test';

// CI and local builds have no SENTRY_DSN_WEB, the same as a preview (spec §10, D50). Such a
// build must never talk to Sentry, and its CSP must not allow it to (Review Focus #4).
test('a build without a DSN sends nothing to Sentry, and its CSP allows only self', async ({
  page,
}) => {
  const sentryRequests: string[] = [];
  page.on('request', (req) => {
    if (/sentry\.io/i.test(new URL(req.url()).hostname)) sentryRequests.push(req.url());
  });
  const res = await page.goto('/');
  await page.waitForLoadState('networkidle');
  // An uncaught error is what the browser SDK would report, if it were initialized. Stay on the
  // page for a moment afterwards: a report would be sent within it. (/signup is no use for this,
  // since its Turnstile widget keeps the network busy and 'networkidle' never settles.)
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          setTimeout(resolve, 500);
          throw new Error('e2e: no DSN, so nobody hears this');
        });
      }),
  );
  expect(sentryRequests).toEqual([]);
  const csp = res?.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("connect-src 'self';");
});
