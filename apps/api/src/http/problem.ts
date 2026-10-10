import { STATUS_CODES } from 'node:http';
import { HttpException } from '@nestjs/common';
import { ErrorCode, type Problem } from '@wishlist/contracts';
import type { Response } from 'express';
import { AppError } from './app-error.js';

const CODE_BY_STATUS: Readonly<Record<number, ErrorCode>> = {
  400: ErrorCode.BAD_REQUEST,
  404: ErrorCode.NOT_FOUND,
  405: ErrorCode.METHOD_NOT_ALLOWED,
  413: ErrorCode.PAYLOAD_TOO_LARGE,
  415: ErrorCode.UNSUPPORTED_MEDIA_TYPE,
  429: ErrorCode.RATE_LIMITED,
};

const MIDDLEWARE_DETAIL_BY_STATUS: Readonly<Record<number, string>> = {
  400: 'The request body is not valid JSON.',
  413: 'The request body is too large.',
  415: 'Unsupported content type.',
};

/** Maps anything thrown while handling a request to the problem we send. Never leaks 5xx detail. */
export function toProblem(exception: unknown, requestId: string): Problem {
  if (exception instanceof AppError) {
    return build(exception.status, exception.code, requestId, exception.detail, exception.extras);
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    return build(status, codeFor(status), requestId, status < 500 ? exception.message : undefined);
  }
  // Errors raised by Express middleware (body-parser) carry a status and an `expose` flag. Their
  // messages are not used, though: a JSON parse error quotes part of the request body, which could
  // be a password. The detail is fixed per status instead.
  if (isExposedClientError(exception)) {
    return build(
      exception.status,
      codeFor(exception.status),
      requestId,
      MIDDLEWARE_DETAIL_BY_STATUS[exception.status],
    );
  }
  return build(500, ErrorCode.INTERNAL_ERROR, requestId);
}

export function sendProblem(res: Response, problem: Problem): void {
  res.status(problem.status).type('application/problem+json').json(problem);
}

function build(
  status: number,
  code: string,
  requestId: string,
  detail?: string,
  extras: Readonly<Record<string, unknown>> = {},
): Problem {
  return {
    ...extras,
    type: 'about:blank',
    title: STATUS_CODES[status] ?? 'Error',
    status,
    code,
    requestId,
    ...(detail === undefined ? {} : { detail }),
  };
}

function codeFor(status: number): string {
  if (status >= 500) return ErrorCode.INTERNAL_ERROR;
  return CODE_BY_STATUS[status] ?? ErrorCode.HTTP_ERROR;
}

function isExposedClientError(error: unknown): error is { status: number; message: string } {
  if (typeof error !== 'object' || error === null) return false;
  const { status, expose, message } = error as Record<string, unknown>;
  return (
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    expose === true &&
    typeof message === 'string'
  );
}
