'use client';

import { captureException } from '@sentry/browser';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { shouldReportBoundaryError } from '@/lib/observability';
import { geist, instrumentSerif } from './fonts';
import './globals.css';

/**
 * Shown when the root layout itself throws, which error.tsx can't catch because it renders inside
 * that layout (D84). It replaces the layout, so it brings its own html, body, fonts and styles.
 * Like error.tsx, it never shows the error's own text (spec §9) and reports a client-side one.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  // A server error, which has a digest, already reached Sentry through onRequestError (spec §9).
  useEffect(() => {
    if (shouldReportBoundaryError(error)) captureException(error);
  }, [error]);

  return (
    <html lang="en" className={`${geist.variable} ${instrumentSerif.variable}`}>
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        <main className="mx-auto max-w-xl px-4 py-24 sm:px-7">
          <h1 className="font-display text-5xl">Something went wrong.</h1>
          <p className="mt-4 text-muted-foreground">
            Try again. If it keeps happening, come back in a few minutes.
          </p>
          <Button className="mt-8" onClick={() => retry()}>
            Try again
          </Button>
        </main>
      </body>
    </html>
  );
}
