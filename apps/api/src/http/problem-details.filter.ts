import { Catch, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { DrizzleQueryError } from 'drizzle-orm';
import type { Response } from 'express';
import { AppError } from './app-error.js';
import { sendProblem, toProblem } from './problem.js';
import { requestIdOf } from './request-id.js';

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemDetails');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const problem = toProblem(exception, requestIdOf(res));
    if (problem.status >= 500) {
      this.logger.error(`[${problem.requestId}] unhandled error`, describeForLog(exception));
    }
    if (exception instanceof AppError) {
      for (const [name, value] of Object.entries(exception.headers)) res.setHeader(name, value);
    }
    sendProblem(res, problem);
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
