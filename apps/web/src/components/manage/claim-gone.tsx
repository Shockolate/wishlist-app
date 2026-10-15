import Link from 'next/link';
import type { Ref } from 'react';

/** A claim that's gone (spec §2): for the 404 page, and for a change or cancel that finds it gone. */
export function ClaimGone({ headingRef }: { headingRef?: Ref<HTMLHeadingElement> }) {
  return (
    <>
      <h1
        ref={headingRef}
        tabIndex={headingRef ? -1 : undefined}
        className="font-display text-5xl leading-tight focus:outline-none"
      >
        This claim no longer exists.
      </h1>
      <p className="mt-4 text-muted-foreground">
        The owner may have removed the item. If you still have the list’s link, open it to see
        what’s on there now.
      </p>
      <p className="mt-8">
        <Link href="/" className="inline-flex min-h-11 items-center underline">
          Go to the home page
        </Link>
      </p>
    </>
  );
}
