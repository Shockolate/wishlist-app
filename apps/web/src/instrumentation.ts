import type { Instrumentation } from 'next';

// Inlined at build by next.config.ts. Empty outside production deploys.
const dsn = process.env.SENTRY_DSN_WEB;

export async function register(): Promise<void> {
  // The positive runtime test is what lets the bundler drop the Node-only code from the Edge bundle.
  if (process.env.NEXT_RUNTIME === 'nodejs' && dsn) {
    // The server bundles carry source maps (next.config.ts): report TypeScript lines (D52).
    process.setSourceMapsEnabled(true);
    const { initServerReporting } = await import('./lib/sentry.server');
    initServerReporting(dsn, process.env.SENTRY_RELEASE ?? 'dev');
  }
}

export const onRequestError: Instrumentation.onRequestError = async (error, _request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || !dsn) return;
  const { reportRequestError } = await import('./lib/sentry.server');
  reportRequestError(error, context.routePath, context.routeType);
};
