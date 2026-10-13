import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { CreateItemRequest, Item } from '@wishlist/contracts';
import { logInViaApi, signUpViaApi, uniqueEmail } from './accounts.js';
import { linkPath, waitForEmail } from './mailpit.js';

const VERIFY = 'Confirm your email for Hanker';

/**
 * A new owner with a confirmed email, logged in (Plan 3b rule 15). The session cookie lands in the
 * page's browser context, so page.goto and page.request both act as them.
 */
export async function verifiedOwner(page: Page, baseURL: string, label: string): Promise<string> {
  const email = uniqueEmail(label);
  await signUpViaApi(page.request, baseURL, email);
  const path = linkPath((await waitForEmail(email, VERIFY)).text, '/verify-email');
  const token = new URL(path, baseURL).searchParams.get('token');
  const verified = await page.request.post('/api/auth/verify-email', {
    headers: { origin: baseURL },
    data: { token },
  });
  expect(verified.status()).toBe(204);
  expect(await logInViaApi(page.request, baseURL, email)).toBe(204);
  return email;
}

/** Adds an item through the API, as the editor would. */
export async function addItemViaApi(
  request: APIRequestContext,
  baseURL: string,
  item: Partial<CreateItemRequest> & { title: string },
): Promise<Item> {
  const res = await request.post('/api/wishlist/items', {
    headers: { origin: baseURL },
    data: item,
  });
  if (res.status() !== 201) throw new Error(`add answered ${res.status()}: ${await res.text()}`);
  return (await res.json()) as Item;
}
