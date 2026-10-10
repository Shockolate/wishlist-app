import { ErrorCode } from '@wishlist/contracts';
import { ApiError, ContractMismatchError } from './api-client';

/** What a person sees for each error code: the one table (spec §7, rule 23). */
export const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  [ErrorCode.INVALID_CREDENTIALS]: "That email and password don't match.",
  [ErrorCode.PASSWORD_BREACHED]:
    'That password has appeared in a data breach. Choose a different one.',
  [ErrorCode.CAPTCHA_FAILED]: "The human check didn't go through. Try it again.",
  [ErrorCode.CAPTCHA_UNAVAILABLE]:
    'Sign-ups and account emails are paused right now. Try again later.',
  [ErrorCode.INVALID_TOKEN]: 'This link has expired or has already been used.',
  [ErrorCode.RATE_LIMITED]: 'Too many attempts. Wait a few minutes and try again.',
  [ErrorCode.UNAUTHENTICATED]: "You're signed out. Log in to continue.",
  [ErrorCode.VALIDATION_FAILED]: 'Some details need fixing.',
  [ErrorCode.FORBIDDEN_ORIGIN]: 'This page is out of date. Reload it and try again.',
};

const FALLBACK = 'Something went wrong on our side. Try again in a moment.';

/** Plain words for any failure; never the server's own text (spec §9). */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return ERROR_MESSAGES[error.problem.code] ?? FALLBACK;
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
