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
  expect(csp).not.toContain('challenges.cloudflare.com');

  const scriptNonces = await page
    .locator('script[nonce]')
    .evaluateAll((scripts) => scripts.map((script) => (script as { nonce?: string }).nonce));
  expect(scriptNonces.length).toBeGreaterThan(0);
  expect(new Set(scriptNonces)).toEqual(new Set([nonce]));

  // Hydration has run by now: Next's client scripts execute before the load event.
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

test('only the Turnstile pages allow Cloudflare’s challenge (rule 6)', async ({ request }) => {
  const cspOf = async (path: string) =>
    (await request.get(path)).headers()['content-security-policy'] ?? '';
  expect(await cspOf('/signup')).toContain('frame-src https://challenges.cloudflare.com');
  expect(await cspOf('/login')).not.toContain('challenges.cloudflare.com');
});

test('signed-out visitors to account pages go to login, keeping where they were going', async ({
  request,
}) => {
  for (const path of ['/list', '/settings']) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers()['location']).toMatch(
      new RegExp(`/login\\?next=${encodeURIComponent(path)}$`),
    );
  }
});

test('a visitor with a session cookie skips the landing page', async ({ request }) => {
  const res = await request.get('/', {
    maxRedirects: 0,
    headers: { cookie: `__Host-session=${'A'.repeat(43)}` },
  });
  expect(res.status()).toBe(307);
  expect(res.headers()['location']).toMatch(/\/list$/);
});

test('robots.txt keeps auth and account pages out of search (spec §6.7)', async ({ request }) => {
  const body = await (await request.get('/robots.txt')).text();
  for (const path of ['/verify-email', '/reset-password', '/list', '/settings']) {
    expect(body).toContain(`Disallow: ${path}`);
  }
});
