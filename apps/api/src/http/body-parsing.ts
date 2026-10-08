import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { sendProblem, toProblem } from './problem.js';
import { requestIdOf } from './request-id.js';

/** Our own JSON parser (Nest's is disabled in APP_OPTIONS) so its errors go through the handler below. */
export const jsonBodyParser: RequestHandler = express.json({ limit: '100kb' });

/**
 * Body-parser failures happen before routing, so Nest's exception filters never see them. This
 * Express error handler renders them as problem+json instead of Express's default HTML page.
 */
export const bodyParseErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  sendProblem(res, toProblem(err, requestIdOf(res)));
};
