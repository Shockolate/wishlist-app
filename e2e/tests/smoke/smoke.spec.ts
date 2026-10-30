import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { ErrorCode, HealthResponseSchema, ProblemSchema } from '@wishlist/contracts';

// Read-only by design (spec §8): smoke tests run against previews and production.
const expectedSha = process.env.EXPECTED_SHA;

const journal = JSON.parse(
  readFileSync(new URL('../../../apps/api/drizzle/meta/_journal.json', import.meta.url), 'utf8'),
) as { entries: unknown[] };

// The e2e package has no DOM types; this is the part of the browser's global the test touches.
type PageGlobal = {
  __cspViolations: string[];
  document: {
    addEventListener(
      type: 'securitypolicyviolation',
      listener: (event: { violatedDirective: string; blockedURI: string }) => void,
    ): void;
  };
};

test('API is healthy through the web origin', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  const body = HealthResponseSchema.parse(await res.json());
  expect(body.status).toBe('ok');
  expect(body.db.ok).toBe(true);
  if (expectedSha) expect(body.sha).toBe(expectedSha);
});

test('the API reads the database that was migrated', async ({ request }) => {
  // The migrator and the API have separate connection strings, so they could disagree.
  const res = await request.get('/api/health');
  const body = HealthResponseSchema.parse(await res.json());
  expect(body.db.migrationsApplied).toBe(journal.entries.length);
});

test('a write from the app’s own origin passes the CSRF guard', async ({ request, baseURL }) => {
  // The guard runs before validation, so an empty body gets past a correct APP_ORIGIN and then
  // stops at 400, before anything is written or a rate limit is counted.
  const res = await request.post('/api/auth/login', {
    headers: { Origin: new URL(baseURL ?? '').origin },
    data: {},
  });
  expect(res.status()).toBe(400);
  expect(ProblemSchema.parse(await res.json()).code).toBe(ErrorCode.VALIDATION_FAILED);
});

test('auth is live: /api/me without a session answers 401 UNAUTHENTICATED', async ({ request }) => {
  const res = await request.get('/api/me');
  expect(res.status()).toBe(401);
  expect(ProblemSchema.parse(await res.json()).code).toBe(ErrorCode.UNAUTHENTICATED);
});

test('an unknown share link answers 404 SHARE_LINK_NOT_FOUND (spec §8)', async ({ request }) => {
  // 22 characters, so it's well-formed; the chance a real list has it is 2^-128.
  const res = await request.get('/api/shared/AAAAAAAAAAAAAAAAAAAAAA');
  expect(res.status()).toBe(404);
  expect(ProblemSchema.parse(await res.json()).code).toBe(ErrorCode.SHARE_LINK_NOT_FOUND);
});

test('landing page renders', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'For when someone asks what you’d like.' }),
  ).toBeVisible();
});

test('the login page renders with its nonce CSP (spec §6.9)', async ({ page }) => {
  const res = await page.goto('/login');
  expect(res?.headers()['content-security-policy']).toMatch(
    /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/,
  );
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('the sign-up page hydrates and renders Turnstile with no CSP violation (spec §6.9)', async ({
  page,
}) => {
  // Only this document's violations: Cloudflare's challenge iframe has its own CSP and its own noise.
  await page.addInitScript(() => {
    const scope = globalThis as unknown as PageGlobal;
    scope.__cspViolations = [];
    scope.document.addEventListener('securitypolicyviolation', (event) => {
      // Zod probes for eval with a caught `Function("")` and falls back when it's refused.
      if (event.blockedURI === 'eval') return;
      scope.__cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/signup');
  // Our client effect renders the widget once its script loads, so this also proves the page
  // hydrated. The token itself may not come: a real widget can challenge a data-center browser.
  await expect(page.locator('input[name="cf-turnstile-response"]')).toBeAttached({
    timeout: 15_000,
  });

  expect(await page.evaluate(() => (globalThis as unknown as PageGlobal).__cspViolations)).toEqual(
    [],
  );
  expect(errors).toEqual([]);
});

test('an unknown share page is a 404 that search engines skip (spec §6.7)', async ({ page }) => {
  const res = await page.goto('/s/AAAAAAAAAAAAAAAAAAAAAA');
  expect(res?.status()).toBe(404);
  expect(res?.headers()['x-robots-tag']).toBe('noindex');
  expect(res?.headers()['referrer-policy']).toBe('no-referrer');
  await expect(
    page.getByRole('heading', { level: 1, name: 'This list’s link doesn’t work.' }),
  ).toBeVisible();
});

test('an unknown share link’s preview image is a 404 that search engines skip (share link previews §5.3)', async ({
  request,
}) => {
  // A 404 rather than a 500 proves the route's module, with sharp and next/og, loads here.
  const res = await request.get('/s/AAAAAAAAAAAAAAAAAAAAAA/preview.jpg');
  expect(res.status()).toBe(404);
  expect(res.headers()['x-robots-tag']).toBe('noindex');
});

test('security.txt is served as text (RFC 9116)', async ({ request }) => {
  const res = await request.get('/.well-known/security.txt');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toMatch(/^text\/plain/);
  expect(await res.text()).toContain('Contact: mailto:hello@hanker.dev');
});

test('pages send Permissions-Policy', async ({ request }) => {
  const res = await request.get('/');
  expect(res.headers()['permissions-policy']).toContain('camera=()');
});
