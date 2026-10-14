import { ErrorCode } from '@wishlist/contracts';
import { AppError } from '../http/app-error.js';

// Claim failures. As everywhere, no detail echoes what the caller sent: never a token.

/** Malformed, unknown and replaced links all look the same (spec §5). */
export const shareLinkNotFound = (): AppError =>
  new AppError(
    404,
    ErrorCode.SHARE_LINK_NOT_FOUND,
    'This share link does not work. The owner may have made a new one.',
  );
