import * as Sentry from '@sentry/node';
import { waitUntil } from '@vercel/functions';
import type { ErrorContext, ErrorReporter } from './error-reporter.js';
import { reportable } from './reportable.js';
import { scrubEvent } from './scrub-event.js';

/**
 * Everything the SDK would collect on its own, switched off (spec §6.7). v11's defaults collect
 * cookies, headers, bodies and stack-frame variables.
 */
export const DATA_COLLECTION_OFF = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
} satisfies Sentry.NodeOptions['dataCollection'];

export interface SentryReporterOptions {
  dsn: string;
  release: string;
  environment: string;
  /** Tests pass a fake; production uses the SDK's own. */
  transport?: Sentry.NodeOptions['transport'];
}

/**
 * Explicit capture only (D50): no auto-instrumentation, so nothing is recorded but what the app
 * reports, and every event passes scrubEvent. Captures are flushed with waitUntil, because Vercel
 * may freeze the function once the response is sent; elsewhere waitUntil does nothing.
 */
export class SentryErrorReporter implements ErrorReporter {
  constructor(options: SentryReporterOptions) {
    Sentry.init({
      dsn: options.dsn,
      release: options.release,
      environment: options.environment,
      defaultIntegrations: false,
      integrations: [
        Sentry.onUncaughtExceptionIntegration(),
        Sentry.onUnhandledRejectionIntegration(),
        Sentry.linkedErrorsIntegration(),
        Sentry.dedupeIntegration(),
      ],
      enableRuntimeChannelInjection: false,
      includeLocalVariables: false,
      dataCollection: DATA_COLLECTION_OFF,
      beforeSend: scrubEvent,
      ...(options.transport ? { transport: options.transport } : {}),
    });
  }

  captureException(error: unknown, context: ErrorContext = {}): void {
    this.report(context, () => Sentry.captureException(reportable(error)));
  }

  captureWarning(message: string, context: ErrorContext = {}): void {
    this.report(context, () => Sentry.captureMessage(message, 'warning'));
  }

  flush(): Promise<boolean> {
    return Sentry.flush(2_000);
  }

  close(): Promise<boolean> {
    return Sentry.close(2_000);
  }

  private report(context: ErrorContext, capture: () => void): void {
    try {
      Sentry.withScope((scope) => {
        if (context.requestId) scope.setTag('requestId', context.requestId);
        if (context.route) scope.setTransactionName(context.route);
        capture();
      });
      waitUntil(this.flush());
    } catch {
      // Reporting must never take the error path down with it.
    }
  }
}
