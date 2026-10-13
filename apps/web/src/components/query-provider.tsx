'use client';

import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorCode } from '@wishlist/contracts';
import { useState, type ReactNode } from 'react';
import { hasCode } from '@/lib/messages';

/**
 * One QueryClient per page load. Queries retry once; writes never retry (spec §9). A refetch that
 * finds the session gone sends the person to log in, by a full navigation, so Back can't restore
 * signed-in pages from the router's cache. Any other failed refetch leaves the list as it was.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (error) => {
            if (!hasCode(error, ErrorCode.UNAUTHENTICATED)) return;
            const here = window.location.pathname + window.location.search;
            window.location.replace(`/login?next=${encodeURIComponent(here)}`);
          },
        }),
        defaultOptions: { queries: { retry: 1 }, mutations: { retry: false } },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
