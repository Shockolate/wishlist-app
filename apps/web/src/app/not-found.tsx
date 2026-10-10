import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';

export default function NotFound() {
  return (
    <>
      <SiteHeader action="none" />
      <main className="mx-auto max-w-xl px-4 py-24 sm:px-7">
        <h1 className="font-display text-5xl">This page isn’t here.</h1>
        <p className="mt-4 text-muted-foreground">
          The link may be mistyped, or the page has moved.
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
