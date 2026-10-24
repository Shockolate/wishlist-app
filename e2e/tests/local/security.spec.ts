import { expect, test } from '@playwright/test';

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

const nonceIn = (csp: string | undefined) => /'nonce-([^']+)'/.exec(csp ?? '')?.[1];

test('a page carries a nonce CSP that its own scripts satisfy (spec §6.9)', async ({ page }) => {
  // Collect violations in the page itself, from the first byte, so nothing slips past.
  await page.addInitScript(() => {
    const scope = globalThis as unknown as PageGlobal;
    scope.__cspViolations = [];
    scope.document.addEventListener('securitypolicyviolation', (event) => {
      scope.__cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  const consoleViolations: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) consoleViolations.push(message.text());
  });

  const res = await page.goto('/', { waitUntil: 'load' });
  const csp = res?.headers()['content-security-policy'];
  const nonce = nonceIn(csp);
  expect(nonce).toBeTruthy();
  expect(csp).toContain("'strict-dynamic'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain('frame-src https://challenges.cloudflare.com');

  const scriptNonces = await page
    .locator('script[nonce]')
    .evaluateAll((scripts) => scripts.map((script) => (script as { nonce?: string }).nonce));
  expect(scriptNonces.length).toBeGreaterThan(0);
  expect(new Set(scriptNonces)).toEqual(new Set([nonce]));

  // Next's client scripts have executed by the load event, so a blocked one would have been
  // reported. Hydration itself may still be finishing.
  const pageViolations = await page.evaluate(
    () => (globalThis as unknown as PageGlobal).__cspViolations,
  );
  expect(pageViolations).toEqual([]);
  expect(consoleViolations).toEqual([]);
});

test('every request gets a fresh nonce', async ({ request }) => {
  const first = nonceIn((await request.get('/')).headers()['content-security-policy']);
  const second = nonceIn((await request.get('/')).headers()['content-security-policy']);
  expect(first).not.toBe(second);
});

test('every page allows Cloudflare’s challenge, so in-app navigation keeps Turnstile working', async ({
  request,
}) => {
  for (const path of ['/', '/login', '/signup']) {
    const csp = (await request.get(path)).headers()['content-security-policy'] ?? '';
    expect(csp, path).toContain('frame-src https://challenges.cloudflare.com');
    expect(csp, path).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  }
});

test('signed-out visitors to account pages go to login, keeping where they were going', async ({
  request,
}) => {
  for (const path of ['/list', '/gifts', '/settings']) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers()['location']).toMatch(
      new RegExp(`/login\\?next=${encodeURIComponent(path)}$`),
    );
  }
});

test('a path that only starts with "api" still gets the CSP; the matcher exempts /api itself', async ({
  request,
}) => {
  const res = await request.get('/apiary');
  expect(res.status()).toBe(404);
  expect(res.headers()['content-security-policy']).toMatch(/'nonce-[^']+' 'strict-dynamic'/);
});

test('a visitor with a session cookie skips the landing page', async ({ request }) => {
  const res = await request.get('/', {
    maxRedirects: 0,
    headers: { cookie: `__Host-session=${'A'.repeat(43)}` },
  });
  expect(res.status()).toBe(307);
  expect(res.headers()['location']).toMatch(/\/list$/);
});

test('robots.txt keeps the token and account pages out of search (spec §6.7)', async ({
  request,
}) => {
  const body = await (await request.get('/robots.txt')).text();
  for (const path of ['/verify-email', '/reset-password', '/list', '/gifts', '/settings']) {
    expect(body).toContain(`Disallow: ${path}`);
  }
});
