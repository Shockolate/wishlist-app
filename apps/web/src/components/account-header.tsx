'use client';

import { ErrorCode } from '@wishlist/contracts';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { NoContentSchema } from '@/lib/api-client';
import { browserApi } from '@/lib/browser-api';
import { errorMessage, hasCode } from '@/lib/messages';
import { cn } from '@/lib/utils';

/** The signed-in header: the wordmark, the two account pages, and Log out. */
export function AccountHeader({ current }: { current: 'list' | 'settings' }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function logOut() {
    setBusy(true);
    setError(null);
    try {
      await browserApi.post('/auth/logout', {}, NoContentSchema);
    } catch (failure) {
      // A 401 means the session was already gone and the API cleared the cookie: same outcome.
      // Anything else (offline, a 5xx) means we may still be signed in, so say so and stay put.
      if (!hasCode(failure, ErrorCode.UNAUTHENTICATED)) {
        setError(errorMessage(failure));
        setBusy(false);
        return;
      }
    }
    // A full navigation, not router.replace: Back and Forward restore soft-navigated pages from
    // the router's in-memory cache without asking the server, which would show the signed-in
    // pages again. Loading a new document drops that cache.
    window.location.replace('/');
  }

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-8 gap-y-3 px-4 py-4 sm:px-7">
        <Link
          href="/list"
          className="inline-flex min-h-11 items-center font-display text-[30px] leading-none no-underline"
        >
          Hanker
        </Link>
        <nav aria-label="Main" className="flex flex-1 gap-1.5 text-[15px] font-medium">
          <NavLink href="/list" current={current === 'list'}>
            Your list
          </NavLink>
          <NavLink href="/settings" current={current === 'settings'}>
            Settings
          </NavLink>
        </nav>
        <Button variant="secondary" size="compact" onClick={logOut} disabled={busy}>
          Log out
        </Button>
        {error ? (
          <Notice tone="error" className="basis-full">
            {error}
          </Notice>
        ) : null}
      </div>
    </header>
  );
}

function NavLink({
  href,
  current,
  children,
}: {
  href: string;
  current: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'inline-flex min-h-11 items-center rounded-full px-4 no-underline',
        current ? 'bg-foreground text-background' : 'text-muted-foreground',
      )}
    >
      {children}
    </Link>
  );
}
