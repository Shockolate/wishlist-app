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

test('landing page renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Wishlist' })).toBeVisible();
});
