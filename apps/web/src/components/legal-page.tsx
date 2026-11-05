import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { SESSION_COOKIE } from '@/lib/session';
import { SiteHeader } from './site-header';

const DATE = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' });

/**
 * The frame for /privacy and /terms (Plan 6): a title, the last-updated date, then sections.
 *
 * With a session cookie, the header links back to the list, as the proxy's redirects do: only
 * the cookie's presence is checked, and the API decides who is signed in. A stale cookie gets a
 * link to /list, which sends them to sign in. Pages are already rendered per request (the root
 * layout's `connection()`, for the CSP nonce), so reading cookies costs nothing extra.
 */
export async function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  /** An ISO date, such as 2026-10-21. */
  updated: string;
  children: ReactNode;
}) {
  return (
    <>
      <SiteHeader action={(await cookies()).has(SESSION_COOKIE) ? 'list' : 'none'} />
      <main className="mx-auto max-w-[680px] px-4 pt-10 pb-24 sm:px-7">
        <h1 className="font-display text-5xl leading-none">{title}</h1>
        <p className="mt-3 text-muted-foreground">
          Last updated <time dateTime={updated}>{DATE.format(new Date(updated))}</time>
        </p>
        <div className="mt-8 space-y-4 text-lg leading-relaxed [&_a]:underline [&_h2]:mt-10 [&_h2]:font-display [&_h2]:text-3xl [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6">
          {children}
        </div>
      </main>
    </>
  );
}
