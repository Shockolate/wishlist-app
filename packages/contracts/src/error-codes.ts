/**
 * Stable, machine-readable error codes carried in every problem response's `code`. The web app
 * switches on these, never on human-readable text. Later plans add domain codes here.
 */
export const ErrorCode = {
  BAD_REQUEST: 'BAD_REQUEST',
  NOT_FOUND: 'NOT_FOUND',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  RATE_LIMITED: 'RATE_LIMITED',
  HTTP_ERROR: 'HTTP_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  /** 400: the request body failed its schema. `errors[]` names each bad field (spec §5). */
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  /** 401: there's no live session. */
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  /** 401 at login; 403 when an authenticated request confirms the wrong password. */
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  /** 400: an email link's token is unknown, expired or already used. */
  INVALID_TOKEN: 'INVALID_TOKEN',
  /** 400: the new password appears in Have I Been Pwned (spec §6.4). */
  PASSWORD_BREACHED: 'PASSWORD_BREACHED',
  /** 400: Turnstile rejected the challenge token. */
  CAPTCHA_FAILED: 'CAPTCHA_FAILED',
  /** 503: Turnstile is unreachable or not configured, so email-sending endpoints refuse (spec §6.5). */
  CAPTCHA_UNAVAILABLE: 'CAPTCHA_UNAVAILABLE',
  /** 403: a state-changing request that didn't come from APP_ORIGIN (spec §6.2). */
  FORBIDDEN_ORIGIN: 'FORBIDDEN_ORIGIN',
  /** 403: the signed-in user hasn't confirmed their email; owner endpoints refuse (spec §5). */
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  /** 422: the list already holds 200 items (spec §2). */
  LIST_FULL: 'LIST_FULL',
  /** 409: a reorder's item IDs aren't exactly the list's current items (spec §5). */
  ORDER_CONFLICT: 'ORDER_CONFLICT',
  /** 409: a claim would take more than the item has left. Carries `remaining` (spec §5). */
  CLAIM_EXCEEDS_REMAINING: 'CLAIM_EXCEEDS_REMAINING',
  /** 403: the list's owner tried to claim from their own list (spec §2). */
  OWNER_CANNOT_CLAIM: 'OWNER_CANNOT_CLAIM',
  /** 404: a share link that's malformed, unknown, or was replaced by a rotation (spec §5). */
  SHARE_LINK_NOT_FOUND: 'SHARE_LINK_NOT_FOUND',
  /** 409: a claim sent a manage token that belongs to a claim on another item (D42). */
  MANAGE_TOKEN_IN_USE: 'MANAGE_TOKEN_IN_USE',
  /** 409: the owner already has a tag with that name, in any case or spacing (design §6). */
  TAG_NAME_TAKEN: 'TAG_NAME_TAKEN',
  /** 422: the list already holds 50 tags (design §3). */
  TAG_LIMIT_REACHED: 'TAG_LIMIT_REACHED',
  /** 422: an item write would leave the item with more than 10 tags (design §3). */
  ITEM_TAG_LIMIT_REACHED: 'ITEM_TAG_LIMIT_REACHED',
  /** Synthesized by the web client when an error response isn't problem+json (e.g. a Vercel edge page). */
  UNEXPECTED_RESPONSE: 'UNEXPECTED_RESPONSE',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
