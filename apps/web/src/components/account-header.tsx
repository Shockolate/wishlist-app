'use client';

import { ErrorCode } from '@wishlist/contracts';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { NoContentSchema } from '@/lib/api-client';
import { browserApi } from '@/lib/browser-api';
import { errorMessage, hasCode, LIST_CHANGE_NOT_SAVED } from '@/lib/messages';
import { useUnseenListFailure } from '@/lib/off-page-failure';
import { cn } from '@/lib/utils';

/** The signed-in header: the wordmark, the account pages, and Sign out. */
export function AccountHeader({ current }: { current: 'list' | 'gifts' | 'settings' }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listFailed = useUnseenListFailure();

  async function logOut() {
    setBusy(true);
    setError(null);
    try {
      await browserApi.post('/auth/logout', {}, NoContentSchema);
    } catch (failure) {
      // Logout answers 204 even without a session, so a 401 isn't expected; if one comes, treat it
      // as signed out, because a 401 always clears the cookie.
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
        {/* Too narrow for one row on a phone: the nav takes a row of its own under the wordmark
            and Sign out. Only the visual order changes, so focus still reaches the nav first. */}
        <nav
          aria-label="Main"
          className="flex flex-1 gap-1.5 text-[15px] font-medium max-sm:order-1 max-sm:basis-full"
        >
          <NavLink href="/list" current={current === 'list'}>
            Your list
          </NavLink>
          <NavLink href="/gifts" current={current === 'gifts'}>
            Your gifts
          </NavLink>
          <NavLink href="/settings" current={current === 'settings'}>
            Settings
          </NavLink>
        </nav>
        <Button
          variant="secondary"
          size="compact"
          className="ml-auto"
          onClick={logOut}
          disabled={busy}
        >
          Sign out
        </Button>
        {error ? (
          <Notice tone="error" className="order-last basis-full">
            {error}
          </Notice>
        ) : null}
        {current === 'settings' && listFailed ? (
          <Notice tone="error" className="order-last basis-full">
            {LIST_CHANGE_NOT_SAVED}{' '}
            <Link href="/list" className="underline">
              Check your list
            </Link>
            .
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
        'inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-3 no-underline sm:px-4',
        current ? 'bg-foreground text-background' : 'text-muted-foreground',
      )}
    >
      {children}
    </Link>
  );
}
