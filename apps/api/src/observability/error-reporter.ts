/** What a report carries besides the error: never the raw URL, a body or a user (spec §6.7). */
export interface ErrorContext {
  requestId?: string;
  /** The route pattern, e.g. /api/claims/:manageToken. */
  route?: string;
}

/** Port for error reporting (spec §10 Monitoring, D50). Reporting never throws. */
export interface ErrorReporter {
  captureException(error: unknown, context?: ErrorContext): void;
  /** An operator-actionable condition that isn't an exception, e.g. Turnstile unavailable. */
  captureWarning(message: string, context?: ErrorContext): void;
}

export const ERROR_REPORTER = Symbol('ERROR_REPORTER');

/** Used when SENTRY_DSN is unset: previews, CI, tests and local development. */
export const NOOP_REPORTER: ErrorReporter = {
  captureException: () => undefined,
  captureWarning: () => undefined,
};
