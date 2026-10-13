import { ErrorCode } from '@wishlist/contracts';
import { ApiError, ContractMismatchError } from './api-client';

/** The words for a used-up or expired emailed link: the code's message, and the pages' headings. */
export const LINK_EXPIRED = 'This link has expired or has already been used.';

/** A password confirmation that failed, shown on the field rather than as a notice. */
export const WRONG_PASSWORD = 'That password isn’t right.';

/** A form was sent before its Turnstile check produced a token. */
export const FINISH_CHECK = 'Finish the check above, then try again.';

/** What a person sees for each error code: the one table (spec §7, Plan 2b rule 23). */
export const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  [ErrorCode.INVALID_CREDENTIALS]: "That email and password don't match.",
  [ErrorCode.PASSWORD_BREACHED]:
    'That password has appeared in a data breach. Choose a different one.',
  [ErrorCode.CAPTCHA_FAILED]: "The human check didn't go through. Try it again.",
  [ErrorCode.CAPTCHA_UNAVAILABLE]:
    'Sign-ups and account emails are paused right now. Try again later.',
  [ErrorCode.INVALID_TOKEN]: LINK_EXPIRED,
  [ErrorCode.RATE_LIMITED]: 'Too many attempts. Wait a few minutes and try again.',
  [ErrorCode.UNAUTHENTICATED]: "You're signed out. Log in to continue.",
  [ErrorCode.VALIDATION_FAILED]: 'Some details need fixing.',
  [ErrorCode.FORBIDDEN_ORIGIN]: 'This page is out of date. Reload it and try again.',
  [ErrorCode.ORDER_CONFLICT]: 'Your list changed on another device, so we’ve reloaded it.',
  [ErrorCode.LIST_FULL]: 'Your list is full: 200 items is the most it can hold.',
  [ErrorCode.EMAIL_NOT_VERIFIED]: 'Confirm your email first, then try again.',
};

const FALLBACK = 'Something went wrong on our side. Try again in a moment.';

/** Plain words for any failure; never the server's own text (spec §9). */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    // hasOwn, so a code like "constructor" can't find something on Object.prototype.
    const { code } = error.problem;
    return (Object.hasOwn(ERROR_MESSAGES, code) ? ERROR_MESSAGES[code] : undefined) ?? FALLBACK;
  }
  if (error instanceof ContractMismatchError) {
    return 'Hanker was just updated. Reload the page and try again.';
  }
  // fetch rejects with a TypeError when the network is down.
  if (error instanceof TypeError)
    return "We couldn't reach Hanker. Check your connection and try again.";
  return FALLBACK;
}

/** Messages by field from a 400 VALIDATION_FAILED; empty for anything else. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || error.problem.code !== ErrorCode.VALIDATION_FAILED) return {};
  return Object.fromEntries((error.problem.errors ?? []).map((e) => [e.path, e.message]));
}

export function hasCode(error: unknown, code: string): boolean {
  return error instanceof ApiError && error.problem.code === code;
}

/** A change to an item that another device already deleted (a 404 on an item route). */
export const ITEM_GONE = 'That item was already removed, so we’ve reloaded your list.';

/** errorMessage for the list editor, where a 404 can only mean the item is gone (Plan 3b rule 4). */
export function listErrorMessage(error: unknown): string {
  return hasCode(error, ErrorCode.NOT_FOUND) ? ITEM_GONE : errorMessage(error);
}
