import { expect, test } from '@playwright/test';
import { ErrorCode, HealthResponseSchema, ProblemSchema } from '@wishlist/contracts';

// Read-only by design (spec §8): smoke tests run against previews and production.
const expectedSha = process.env.EXPECTED_SHA;

test('API is healthy through the web origin', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  const body = HealthResponseSchema.parse(await res.json());
  expect(body.status).toBe('ok');
  expect(body.db.ok).toBe(true);
  if (expectedSha) expect(body.sha).toBe(expectedSha);
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
    page.getByRole('heading', { level: 1, name: 'One list. One link. No doubled-up gifts.' }),
  ).toBeVisible();
});

test('the login page renders with its nonce CSP (spec §6.9)', async ({ page }) => {
  const res = await page.goto('/login');
  expect(res?.headers()['content-security-policy']).toMatch(
    /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/,
  );
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
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
