import { DrizzleQueryError } from 'drizzle-orm';

/**
 * The error to report in place of `error`. Drizzle puts every bound parameter (emails, password
 * hashes, display names) in a failed query's message and stack, so one is rebuilt from its
 * parameterized SQL and the driver's error, as ProblemDetailsFilter already logs it.
 */
export function reportable(error: unknown): unknown {
  if (!(error instanceof DrizzleQueryError)) return error;
  const cause = error.cause;
  const rebuilt = new Error(
    `Failed query: ${error.query}${cause instanceof Error ? `\n${cause.message}` : ''}`,
  );
  rebuilt.name = 'DrizzleQueryError';
  if (cause instanceof Error && cause.stack) {
    rebuilt.stack = `${rebuilt.name}: ${rebuilt.message}\n${cause.stack.split('\n').slice(1).join('\n')}`;
  }
  return rebuilt;
}
