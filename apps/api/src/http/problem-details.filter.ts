import { Catch, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
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
      this.logger.error(
        `[${problem.requestId}] unhandled error`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    if (exception instanceof AppError) {
      for (const [name, value] of Object.entries(exception.headers)) res.setHeader(name, value);
    }
    sendProblem(res, problem);
  }
}
