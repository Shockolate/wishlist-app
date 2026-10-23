import {
  ErrorCode,
  retailerOf,
  type Retailer,
  type UnfurlFailureReason,
  type UnfurlResponse,
} from '@wishlist/contracts';
import { ApiError, ContractMismatchError } from './api-client';
import { shopName } from './item-display';

/** The words for a used-up or expired emailed link: the code's message, and the pages' headings. */
export const LINK_EXPIRED = 'This link has expired or has already been used.';

/** A password confirmation that failed, shown on the field rather than as a notice. */
export const WRONG_PASSWORD = 'That password isn’t right.';

/** A form was sent before its Turnstile check produced a token. */
export const FINISH_CHECK = 'Finish the check above, then try again.';

/** Turnstile's script never loaded: a content blocker, or a network that drops it (D38). */
export const TURNSTILE_BLOCKED =
  'We couldn’t load the security check. If you use a content blocker, allow hanker.dev, or try another browser.';

/** The widget loaded, then failed. */
export const TURNSTILE_FAILED = 'The check didn’t work. Reload the page to try again.';

/** An item's 11th tag: the API's answer, and the tag field's refusal before sending (Plan 7b ruling 7). */
export const ITEM_TAG_LIMIT = 'An item can have at most 10 tags.';

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
  [ErrorCode.OWNER_CANNOT_CLAIM]: 'You can’t claim from your own list.',
  [ErrorCode.MANAGE_TOKEN_IN_USE]:
    'Something went wrong with this claim. Close this and try again.',
  [ErrorCode.SHARE_LINK_NOT_FOUND]: 'This list’s link doesn’t work any more.',
  [ErrorCode.TAG_NAME_TAKEN]: 'You already have a tag called that.',
  [ErrorCode.TAG_LIMIT_REACHED]: 'Your list has 50 tags, the most it can hold.',
  [ErrorCode.ITEM_TAG_LIMIT_REACHED]: ITEM_TAG_LIMIT,
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

/** The claim sheet, when someone else took the last one first (spec §7 step 4). */
export const LAST_ONE_GONE = 'Someone else just claimed the last one.';

/** The claim sheet, when the owner deleted the item while it was open. */
export const ITEM_TAKEN_OFF = 'This item was just taken off the list.';

/** The claim sheet's 409 when some are still left: the stepper was set to them (spec §7). */
export function claimConflictMessage(left: number): string {
  return `Someone else claimed some while you were choosing, so only ${left} ${left === 1 ? 'is' : 'are'} left. We’ve set how many to ${left}.`;
}

/** The manage page's 409: the claim can go no higher than this now (spec §2). */
export function claimChangeConflictMessage(max: number): string {
  return `Someone else claimed some, so you can have up to ${max} now. We’ve set how many to ${max}.`;
}

/** errorMessage for the list editor, where a 404 can only mean the item is gone (Plan 3b rule 4). */
export function listErrorMessage(error: unknown): string {
  return hasCode(error, ErrorCode.NOT_FOUND) ? ITEM_GONE : errorMessage(error);
}

/** Another row was tapped while the open one had unsaved changes (Plan 3b rule 8). */
export const FINISH_EDITING = 'Save or cancel the item you’re editing first.';

/** The add box (Plan 3b rule 5). */
export const ADD_BOX_EMPTY = 'Paste a link or type an idea.';
export const OTHER_SCHEME_LINK = 'Links must start with http:// or https://';
export const LINK_TOO_LONG = 'Use 2048 characters or fewer.';

const CANT_REACH = 'We couldn’t reach that page, so fill in the details yourself.';
const NO_DETAILS = 'We couldn’t find the details on that page, so fill them in yourself.';
const NOT_PUBLIC = 'That link doesn’t go to a public web page.';

/** Why a prefill came back empty: one sentence per reason, so a new reason needs its own (rule 6). */
export const UNFURL_MESSAGES: Readonly<Record<UnfurlFailureReason, string>> = {
  BLOCKED_BY_SITE: 'That shop didn’t let us read the page, so fill in the details yourself.',
  DNS_FAILED: 'We couldn’t find that site. Check the link, or fill in the details yourself.',
  TIMEOUT: CANT_REACH,
  UNREACHABLE: CANT_REACH,
  NOT_HTML: NO_DETAILS,
  TOO_LARGE: NO_DETAILS,
  NO_METADATA: NO_DETAILS,
  TOO_MANY_REDIRECTS: NO_DETAILS,
  INVALID_URL: NOT_PUBLIC,
  DISALLOWED_ADDRESS: NOT_PUBLIC,
  LOOKUP_UNAVAILABLE: 'We couldn’t get the details right now, so fill them in yourself.',
};
/** LOOKUP_UNAVAILABLE for a retailer's link names the shop (retailer lookups §5.4). */
const RETAILER_NAMES: Record<Retailer, string> = { amazon: 'Amazon', etsy: 'Etsy' };
export const UNFURL_RATE_LIMITED =
  'You’ve added a lot of links this hour, so fill in the details yourself.';
export const UNFURL_FAILED = 'We couldn’t read that page, so fill in the details yourself.';

/** The add box's waiting panel for an Amazon link (retailer lookups §5.5): the status line. */
export const AMAZON_WAIT = 'Getting the details from Amazon…';
/** The panel's second line: Bright Data takes 4–22 seconds, and we give up at 30. */
export const AMAZON_WAIT_HINT = 'Amazon can take up to half a minute.';
/** The panel's button, which opens the form without waiting. */
export const SKIP_LOOKUP = 'Skip, I’ll type them';
/** Above the form after Skip. */
export const LOOKUP_SKIPPED = 'Fill in the details yourself.';
/** Above the form an idea opens (Plan 9 ruling 1): the idea is already the title. */
export const IDEA_FORM = 'Add any details, then add it to your list.';

/** The sentence above a new item's form: what unfurl found, or why it found nothing. */
export function prefillMessage(
  outcome: { response: UnfurlResponse } | { error: unknown },
  url: string,
): string {
  if ('error' in outcome) {
    return hasCode(outcome.error, ErrorCode.RATE_LIMITED) ? UNFURL_RATE_LIMITED : UNFURL_FAILED;
  }
  const { failureReason } = outcome.response;
  const retailer = retailerOf(url);
  if (failureReason === 'LOOKUP_UNAVAILABLE' && retailer) {
    return `We couldn’t get the details from ${RETAILER_NAMES[retailer]} right now, so fill them in yourself.`;
  }
  if (failureReason) return UNFURL_MESSAGES[failureReason];
  return `Filled in from ${shopName(url) ?? 'the page'}. Check it, then add it.`;
}

/** On /settings, when a list change made on /list failed after the owner left it. */
export const LIST_CHANGE_NOT_SAVED = 'A change to your list didn’t save.';
