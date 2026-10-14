'use client';

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorCode, type WishlistResponse } from '@wishlist/contracts';
import type { ReactNode } from 'react';
import { stripClaims, WISHLIST_KEY } from '@/lib/list-cache';
import { hasCode } from '@/lib/messages';
import { reportListFailure } from '@/lib/off-page-failure';

/**
 * Queries retry once; writes never retry (spec §9). A refetch that finds the session gone sends
 * the person to log in, by a full navigation, so Back can't restore signed-in pages from the
 * router's cache. Any other failed refetch leaves the list as it was.
 */
function makeClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        if (!hasCode(error, ErrorCode.UNAUTHENTICATED)) return;
        const here = window.location.pathname + window.location.search;
        window.location.replace(`/login?next=${encodeURIComponent(here)}`);
      },
    }),
    // Every mutation here is a list change. One that fails after the editor has gone would
    // otherwise fail silently (Plan 3b carry).
    mutationCache: new MutationCache({ onError: () => reportListFailure() }),
    defaultOptions: { queries: { retry: 1 }, mutations: { retry: false } },
  });
}

let browser: { userId: string; client: QueryClient } | undefined;

/**
 * One QueryClient per document and signed-in user in the browser (TanStack's App Router pattern),
 * and a new one per server render. Next restores a page's server render from its router cache on
 * Back, which remounts this provider with that render's data. A remount must reuse the live cache,
 * not reseed from the render: the render predates the owner's edits, and the changes still queued
 * from before the navigation live in this client. Someone else signing in, from another tab, gets a
 * fresh client, so the last account's list is never shown under theirs.
 */
function getClient(userId: string): QueryClient {
  if (typeof window === 'undefined') return makeClient();
  if (browser?.userId !== userId) browser = { userId, client: makeClient() };
  return browser.client;
}

export function QueryProvider({ userId, children }: { userId: string; children: ReactNode }) {
  return <QueryClientProvider client={getClient(userId)}>{children}</QueryClientProvider>;
}

/**
 * Changes the list this document has cached, if it has one. Settings isn't inside the provider, but
 * Back to /list reuses this cache, so a new title or share link has to reach it there: removing the
 * list instead would make /list reseed from the router's stale render.
 */
export function updateCachedList(change: (list: WishlistResponse) => WishlistResponse): void {
  browser?.client.setQueryData<WishlistResponse>(WISHLIST_KEY, (list) =>
    list ? change(list) : list,
  );
}

/** Marks the cached list stale, so /list fetches it again when it next shows (Plan 4b rule 12). */
export function invalidateCachedList(): void {
  void browser?.client.invalidateQueries({ queryKey: WISHLIST_KEY });
}

/**
 * Drops every claim from the cached list, for good (spec §5.1). A list fetch still on its way was
 * started before the owner opted out, and would write its claims back when it lands. So the fetch
 * is cancelled first: that reverts the cache to what it held before the fetch began, claims and
 * all, and settles asynchronously. Only then is the cache stripped, or the revert would undo it.
 */
export async function hideCachedClaims(): Promise<void> {
  if (!browser) return;
  await browser.client.cancelQueries({ queryKey: WISHLIST_KEY });
  updateCachedList(stripClaims);
}
