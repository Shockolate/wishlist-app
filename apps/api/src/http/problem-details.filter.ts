import { Catch, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { DrizzleQueryError } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { NOOP_REPORTER, type ErrorReporter } from '../observability/error-reporter.js';
import { AppError } from './app-error.js';
import { sendProblem, toProblem } from './problem.js';
import { requestIdOf } from './request-id.js';

type HttpHost = ReturnType<ArgumentsHost['switchToHttp']>;

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemDetails');

  constructor(private readonly reporter: ErrorReporter = NOOP_REPORTER) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const problem = toProblem(exception, requestIdOf(res));
    if (problem.status >= 500) {
      this.logger.error(`[${problem.requestId}] unhandled error`, describeForLog(exception));
      this.report(exception, problem.requestId, http);
    }
    if (exception instanceof AppError) {
      for (const [name, value] of Object.entries(exception.headers)) res.setHeader(name, value);
    }
    sendProblem(res, problem);
  }

  /**
   * The route pattern, never the URL: it carries tokens (spec §6.7). Reporting can't throw, and
   * that includes reading the request: it happens inside the try, so a host without one still
   * reports the error, just without a route.
   */
  private report(exception: unknown, requestId: string, http: HttpHost): void {
    try {
      this.reporter.captureException(exception, { requestId, ...routeOf(http) });
    } catch {
      // The response matters more than the report.
    }
  }
}

function routeOf(http: HttpHost): { route?: string } {
  try {
    // Express types `route` as any: it is unset when no route matched.
    const matched = http.getRequest<Request | undefined>()?.route as { path?: unknown } | undefined;
    const route = matched?.path;
    return typeof route === 'string' ? { route } : {};
  } catch {
    return {};
  }
}

/**
 * Drizzle puts every bound parameter (emails, password hashes, display names) in a failed query's
 * message and stack, so for those we log the parameterized SQL and the driver's error instead.
 */
function describeForLog(exception: unknown): string | undefined {
  if (exception instanceof DrizzleQueryError) {
    const { cause } = exception;
    return `Failed query: ${exception.query}\n${cause instanceof Error ? cause.stack : String(cause)}`;
  }
  return exception instanceof Error ? exception.stack : String(exception);
}
