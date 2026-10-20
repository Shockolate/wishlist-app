import 'server-only';
import * as Sentry from '@sentry/node';
import { waitUntil } from '@vercel/functions';
import { DATA_COLLECTION_OFF, scrubEvent } from './observability';

/** Explicit capture only (D50), as in the API: nothing is reported but onRequestError's errors. */
export function initServerReporting(dsn: string, release: string): void {
  Sentry.init({
    dsn,
    release,
    environment: 'production',
    defaultIntegrations: false,
    integrations: [Sentry.linkedErrorsIntegration(), Sentry.dedupeIntegration()],
    enableRuntimeChannelInjection: false,
    includeLocalVariables: false,
    dataCollection: DATA_COLLECTION_OFF,
    beforeSend: scrubEvent,
  });
}

/**
 * A render, route or action error from onRequestError, grouped by the route pattern
 * (/s/[shareToken]), never the path. Flushed with waitUntil, since Vercel may freeze the function
 * once the response is sent. Reporting never throws.
 */
export function reportRequestError(error: unknown, routePath: string, routeType: string): void {
  try {
    Sentry.withScope((scope) => {
      scope.setTransactionName(routePath);
      scope.setTag('routeType', routeType);
      Sentry.captureException(error);
    });
    waitUntil(Sentry.flush(2_000));
  } catch {
    // The page's own error handling goes on regardless.
  }
}
