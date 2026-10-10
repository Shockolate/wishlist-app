import { ErrorCode } from '@wishlist/contracts';
import { AppError } from './app-error.js';

// Shared failures. Details are generic on purpose: they never echo what the caller sent.

export const unauthenticated = (): AppError =>
  new AppError(401, ErrorCode.UNAUTHENTICATED, 'Sign in to continue.');

export const forbiddenOrigin = (): AppError =>
  new AppError(403, ErrorCode.FORBIDDEN_ORIGIN, 'Cross-site requests are not allowed.');

export const unsupportedMediaType = (): AppError =>
  new AppError(415, ErrorCode.UNSUPPORTED_MEDIA_TYPE, 'Send request bodies as application/json.');

export const rateLimited = (retryAfterSeconds: number): AppError =>
  new AppError(
    429,
    ErrorCode.RATE_LIMITED,
    'Too many attempts. Try again later.',
    {},
    { 'Retry-After': String(retryAfterSeconds) },
  );

export const validationFailed = (errors: { path: string; message: string }[]): AppError =>
  new AppError(400, ErrorCode.VALIDATION_FAILED, 'Some fields are invalid.', { errors });
