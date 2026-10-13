'use client';

import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorCode } from '@wishlist/contracts';
import type { ReactNode } from 'react';
import { hasCode } from '@/lib/messages';

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
    defaultOptions: { queries: { retry: 1 }, mutations: { retry: false } },
  });
}

let browserClient: QueryClient | undefined;

/**
 * One QueryClient per document in the browser (TanStack's App Router pattern), and a new one per
 * server render. Next restores a page's server render from its router cache on Back, which remounts
 * this provider with that render's data. A remount must reuse the live cache, not reseed from the
 * render: the render predates the owner's edits, and the changes still queued from before the
 * navigation live in this client.
 */
function getClient(): QueryClient {
  if (typeof window === 'undefined') return makeClient();
  browserClient ??= makeClient();
  return browserClient;
}

export function QueryProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={getClient()}>{children}</QueryClientProvider>;
}
