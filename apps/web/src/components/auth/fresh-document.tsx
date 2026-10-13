'use client';

import { useEffect } from 'react';
import { cameByClientNavigation } from '@/lib/soft-navigation';

/**
 * Reloads the login page when a client-side navigation brought it here with `next`, which is how
 * requireMe and the proxy send someone whose session has ended. The router's in-memory cache still
 * holds the signed-in pages they left, and Back would restore them. A fresh document drops that
 * cache (D38, Plan 3b rule 14).
 */
export function FreshDocument() {
  useEffect(() => {
    const [entry] = performance.getEntriesByType('navigation');
    const here = window.location.href;
    if (!entry || !new URL(here).searchParams.has('next')) return;
    if (cameByClientNavigation(entry.name, here)) window.location.replace(here);
  }, []);
  return null;
}
