import { ErrorCode } from '@wishlist/contracts';
import { AppError } from '../http/app-error.js';

// List failures. As everywhere, no detail echoes what the caller sent.

/** Another user's item, a missing one and a malformed ID all look the same (spec §5). */
export const itemNotFound = (): AppError =>
  new AppError(404, ErrorCode.NOT_FOUND, 'That item no longer exists.');

export const listFull = (): AppError =>
  new AppError(422, ErrorCode.LIST_FULL, 'A list holds at most 200 items.');

export const orderConflict = (): AppError =>
  new AppError(409, ErrorCode.ORDER_CONFLICT, 'The list changed. Reload it and try again.');
