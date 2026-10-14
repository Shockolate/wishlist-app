import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';

/** A share link that's mistyped, unknown, or replaced by a rotation (spec §2, §7). */
export default function ShareLinkNotFound() {
  return (
    <>
      <SiteHeader action="none" />
      <main className="mx-auto max-w-xl px-4 py-24 sm:px-7">
        <h1 className="font-display text-5xl leading-tight">This list’s link doesn’t work.</h1>
        <p className="mt-4 text-muted-foreground">
          It may be mistyped, or the owner may have made a new link. Ask whoever sent it to you for
          the current one.
        </p>
        <p className="mt-3 text-muted-foreground">
          If you claimed something, the link you saved for your claim still works.
        </p>
        <p className="mt-8">
          <Link href="/" className="inline-flex min-h-11 items-center underline">
            Go to the home page
          </Link>
        </p>
      </main>
    </>
  );
}
