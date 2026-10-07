import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

const MAX_VERCEL_ID_LENGTH = 128;
const VERCEL_ID_PATTERN = /^[a-z0-9:-]+$/i;

/**
 * Gives each request an ID, echoed in `x-request-id` and in every problem response. Vercel's edge
 * sets `x-vercel-id` (clients can't override it there), so we reuse it to line our errors up with
 * Vercel's logs. A client-sent `x-request-id` is ignored: trusting it would let callers forge or
 * collide IDs in our logs.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const vercelId = req.header('x-vercel-id');
  const id =
    vercelId && vercelId.length <= MAX_VERCEL_ID_LENGTH && VERCEL_ID_PATTERN.test(vercelId)
      ? vercelId
      : randomUUID();
  res.locals.requestId = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
}

export function requestIdOf(res: Response): string {
  const value: unknown = res.locals.requestId;
  return typeof value === 'string' ? value : 'unknown';
}
