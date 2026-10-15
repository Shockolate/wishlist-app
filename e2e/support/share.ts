import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
} from '@playwright/test';
import type {
  CreateClaimRequest,
  CreateClaimResponse,
  WishlistResponse,
} from '@wishlist/contracts';

/** The share token of the signed-in owner's list, from `GET /wishlist`. */
export async function shareTokenOf(request: APIRequestContext): Promise<string> {
  const res = await request.get('/api/wishlist');
  expect(res.status()).toBe(200);
  const { shareUrl } = (await res.json()) as WishlistResponse;
  const token = shareUrl.split('/s/')[1];
  if (!token) throw new Error(`no token in ${shareUrl}`);
  return token;
}

/** A browser with no session: someone the owner sent the link to. */
export function guest(browser: Browser, baseURL: string): Promise<BrowserContext> {
  return browser.newContext({ baseURL });
}

/** Claims through the API, as a gifter's browser would. */
export async function claimViaApi(
  request: APIRequestContext,
  baseURL: string,
  shareToken: string,
  itemId: string,
  body: Partial<CreateClaimRequest> & { claimerName: string },
): Promise<CreateClaimResponse> {
  const res = await request.post(`/api/shared/${shareToken}/items/${itemId}/claims`, {
    headers: { origin: baseURL },
    data: body,
  });
  if (res.status() !== 201) throw new Error(`claim answered ${res.status()}: ${await res.text()}`);
  return (await res.json()) as CreateClaimResponse;
}
