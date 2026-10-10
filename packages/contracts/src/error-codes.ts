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
  /** Synthesized by the web client when an error response isn't problem+json (e.g. a Vercel edge page). */
  UNEXPECTED_RESPONSE: 'UNEXPECTED_RESPONSE',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
