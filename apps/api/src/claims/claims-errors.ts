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

export const ownerCannotClaim = (): AppError =>
  new AppError(403, ErrorCode.OWNER_CANNOT_CLAIM, 'You cannot claim items on your own list.');

/** Carries what's left, so the claim sheet can reset its stepper (spec §7). */
export const claimExceedsRemaining = (remaining: number): AppError =>
  new AppError(409, ErrorCode.CLAIM_EXCEEDS_REMAINING, 'There are not that many left to claim.', {
    remaining,
  });
