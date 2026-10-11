import type { APIRequestContext } from '@playwright/test';

export const PASSWORD = 'correct horse battery 1';

/** A fresh address per test: Mailpit keeps everything, and accounts must not collide. */
export function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/** Cloudflare's test secret accepts this token (Plan 2a Task 13). */
const TEST_TURNSTILE_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

/** Signs up through the API, as the browser would, without driving the form. */
export async function signUpViaApi(
  request: APIRequestContext,
  baseURL: string,
  email: string,
  displayName = 'Ada',
): Promise<void> {
  const res = await request.post('/api/auth/signup', {
    headers: { origin: baseURL },
    data: { email, password: PASSWORD, displayName, turnstileToken: TEST_TURNSTILE_TOKEN },
  });
  if (res.status() !== 202) {
    throw new Error(`signup answered ${res.status()}: ${await res.text()}`);
  }
}

/** Logs in through the API. The cookie lands in the page's browser context. */
export async function logInViaApi(
  request: APIRequestContext,
  baseURL: string,
  email: string,
  password = PASSWORD,
): Promise<number> {
  const res = await request.post('/api/auth/login', {
    headers: { origin: baseURL },
    data: { email, password },
  });
  return res.status();
}
