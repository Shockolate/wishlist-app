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
  /** Synthesized by the web client when an error response isn't problem+json (e.g. a Vercel edge page). */
  UNEXPECTED_RESPONSE: 'UNEXPECTED_RESPONSE',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
