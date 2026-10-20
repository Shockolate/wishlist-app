'use client';

import { captureException } from '@sentry/browser';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { shouldReportBoundaryError } from '@/lib/observability';

/** Shown when a page throws. It never shows the error's own text (spec §9), and reports a client-side one. */
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  // A client-side error reaches Sentry here. A server one, which has a digest, already did
  // through onRequestError (spec §9).
  useEffect(() => {
    if (shouldReportBoundaryError(error)) captureException(error);
  }, [error]);

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
