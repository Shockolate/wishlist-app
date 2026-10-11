'use client';

import { Button } from '@/components/ui/button';

/** Shown when a page throws. It never shows the error's own text (spec §9). */
export default function ErrorPage({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="mx-auto max-w-xl px-4 py-24 sm:px-7">
      <h1 className="font-display text-5xl">Something went wrong.</h1>
      <p className="mt-4 text-muted-foreground">
        Try again. If it keeps happening, come back in a few minutes.
      </p>
      <Button className="mt-8" onClick={() => retry()}>
        Try again
      </Button>
    </main>
  );
}
