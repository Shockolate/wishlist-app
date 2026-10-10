import { ErrorCode } from '@wishlist/contracts';
import { AppError } from '../http/app-error.js';

// Account failures. As everywhere, no detail echoes what the caller sent.

export const invalidToken = (): AppError =>
  new AppError(400, ErrorCode.INVALID_TOKEN, 'This link is invalid or has expired.');

export const captchaFailed = (): AppError =>
  new AppError(400, ErrorCode.CAPTCHA_FAILED, 'The human check failed. Try again.');

export const captchaUnavailable = (): AppError =>
  new AppError(
    503,
    ErrorCode.CAPTCHA_UNAVAILABLE,
    "We can't check requests right now. Try again later.",
  );

/** Login (spec §5): the same answer for an unknown email and a wrong password. */
export const invalidCredentials = (): AppError =>
  new AppError(401, ErrorCode.INVALID_CREDENTIALS, 'Email or password is incorrect.');

/** A signed-in user confirmed the wrong password. 403, because a 401 would read as "signed out". */
export const wrongPassword = (): AppError =>
  new AppError(403, ErrorCode.INVALID_CREDENTIALS, 'That password is incorrect.');
