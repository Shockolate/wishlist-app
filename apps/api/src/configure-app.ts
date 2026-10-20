import type { NestApplicationOptions } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { bodyParseErrorHandler, jsonBodyParser } from './http/body-parsing.js';
import { ProblemDetailsFilter } from './http/problem-details.filter.js';
import { requestId } from './http/request-id.js';
import {
  ERROR_REPORTER,
  NOOP_REPORTER,
  type ErrorReporter,
} from './observability/error-reporter.js';

/**
 * Nest's built-in body parser is disabled so ours, and its error handler, run in a known order.
 * Tests must create apps with these same options.
 */
export const APP_OPTIONS = { bodyParser: false } satisfies NestApplicationOptions;

/** The production HTTP pipeline. main.ts and every test app go through this one function. */
export function configureApp(app: NestExpressApplication): NestExpressApplication {
  app.disable('x-powered-by');
  app.setGlobalPrefix('api');
  app.use(requestId);
  app.use(jsonBodyParser);
  app.use(bodyParseErrorHandler);
  app.useGlobalFilters(new ProblemDetailsFilter(reporterOf(app)));
  return app;
}

/** The app's reporter. Unit-test apps built without CoreModule have none, and report nowhere. */
function reporterOf(app: NestExpressApplication): ErrorReporter {
  try {
    return app.get<ErrorReporter>(ERROR_REPORTER, { strict: false });
  } catch {
    return NOOP_REPORTER;
  }
}
