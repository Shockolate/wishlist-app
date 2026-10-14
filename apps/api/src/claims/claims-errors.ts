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

/** A manage token that belongs to a claim on another item (D42). Says nothing more. */
export const manageTokenInUse = (): AppError =>
  new AppError(409, ErrorCode.MANAGE_TOKEN_IN_USE, 'This claim link is already in use.');

/** Carries what's left, so the claim sheet can reset its stepper (spec §7). */
export const claimExceedsRemaining = (remaining: number): AppError =>
  new AppError(409, ErrorCode.CLAIM_EXCEEDS_REMAINING, 'There are not that many left to claim.', {
    remaining,
  });

/** Malformed, unknown and deleted claims all look the same (spec §2). */
export const claimNotFound = (): AppError =>
  new AppError(
    404,
    ErrorCode.NOT_FOUND,
    'This claim no longer exists. The owner may have removed the item.',
  );
