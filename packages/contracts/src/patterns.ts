// No zod here: redact.ts imports these, and the browser loads redact.ts on every page. Importing
// even zod's regexes module pulls its schema core into that bundle.

/**
 * A share or manage token: 16 random bytes, base64url without padding (spec §4). The API checks
 * path parameters against it first: a malformed token gets the same 404 as an unknown one.
 */
export const CAPABILITY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** An email-link token: 256 random bits, base64url without padding (spec §4). */
export const EMAIL_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * The pattern z.email() validates EmailSchema with: zod's `regexes.email`, copied so redaction can
 * use it without zod. patterns.spec.ts fails if zod's changes.
 */
export const EMAIL_PATTERN =
  // eslint-disable-next-line no-useless-escape -- zod's source, verbatim, so the spec can compare it
  /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
