import { expect, test } from '@playwright/test';
import { ErrorCode, HealthResponseSchema, ProblemSchema } from '@wishlist/contracts';

test('the landing page introduces Hanker and links to sign-up and login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Hanker');
  await expect(
    page.getByRole('heading', { level: 1, name: 'One list. One link. No doubled-up gifts.' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create your list' })).toHaveAttribute(
    'href',
    '/signup',
  );
  await expect(page.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
});

test('/api/* reaches the API through the same-origin rewrite', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  expect(res.headers()['x-request-id']).toBeTruthy();
  const body = HealthResponseSchema.parse(await res.json());
  expect(body).toMatchObject({ status: 'ok', sha: 'e2e', db: { ok: true } });
});

test('unknown API routes answer with problem+json through the rewrite', async ({ request }) => {
  const res = await request.get('/api/definitely-not-a-route');
  expect(res.status()).toBe(404);
  expect(res.headers()['content-type']).toContain('application/problem+json');
  expect(ProblemSchema.parse(await res.json()).code).toBe(ErrorCode.NOT_FOUND);
});
