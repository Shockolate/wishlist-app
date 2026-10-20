import * as Sentry from '@sentry/browser';
import { DATA_COLLECTION_OFF, scrubEvent } from '@/lib/observability';

// Inlined at build by next.config.ts. Empty outside production deploys, so this does nothing.
const dsn = process.env.SENTRY_DSN_WEB;

if (dsn) {
  Sentry.init({
    dsn,
    release: process.env.SENTRY_RELEASE,
    environment: 'production',
    defaultIntegrations: false,
    integrations: [
      Sentry.globalHandlersIntegration(),
      Sentry.linkedErrorsIntegration(),
      Sentry.dedupeIntegration(),
    ],
    dataCollection: DATA_COLLECTION_OFF,
    beforeSend: scrubEvent,
  });
}
