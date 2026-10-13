import { ErrorCode, type Problem } from '@wishlist/contracts';
import { describe, expect, it } from 'vitest';
import { ApiError, ContractMismatchError } from './api-client';
import {
  ERROR_MESSAGES,
  errorMessage,
  fieldErrors,
  hasCode,
  ITEM_GONE,
  listErrorMessage,
} from './messages';

const apiError = (code: string, extra: Partial<Problem> = {}) =>
  new ApiError({ type: 'about:blank', title: 'x', status: 400, code, requestId: 'r', ...extra });

describe('errorMessage (spec §7, §9)', () => {
  it.each(Object.entries(ERROR_MESSAGES))('says %s in plain words', (code, message) => {
    expect(errorMessage(apiError(code))).toBe(message);
  });

  it('never shows the server’s own text', () => {
    const message = errorMessage(
      apiError(ErrorCode.INTERNAL_ERROR, { status: 500, detail: 'pg: connection terminated' }),
    );
    expect(message).toBe('Something went wrong on our side. Try again in a moment.');
  });

  it('gives an unknown code, even one that names an Object.prototype member, the generic message', () => {
    const generic = 'Something went wrong on our side. Try again in a moment.';
    expect(errorMessage(apiError('constructor'))).toBe(generic);
    expect(errorMessage(apiError('toString'))).toBe(generic);
    expect(errorMessage(apiError('__proto__'))).toBe(generic);
  });

  it('explains a lost connection and a version mismatch', () => {
    expect(errorMessage(new TypeError('Failed to fetch'))).toBe(
      "We couldn't reach Hanker. Check your connection and try again.",
    );
    expect(errorMessage(new ContractMismatchError('GET /me', []))).toBe(
      'Hanker was just updated. Reload the page and try again.',
    );
  });

  it('says sign-ups are paused while Turnstile is unavailable (Plan 2b rule 3)', () => {
    expect(errorMessage(apiError(ErrorCode.CAPTCHA_UNAVAILABLE, { status: 503 }))).toBe(
      'Sign-ups and account emails are paused right now. Try again later.',
    );
  });
});

describe('fieldErrors', () => {
  it('turns a VALIDATION_FAILED problem into messages by field', () => {
    const error = apiError(ErrorCode.VALIDATION_FAILED, {
      errors: [{ path: 'displayName', message: 'Use visible characters only' }],
    });
    expect(fieldErrors(error)).toEqual({ displayName: 'Use visible characters only' });
  });

  it('is empty for anything else', () => {
    expect(fieldErrors(apiError(ErrorCode.RATE_LIMITED))).toEqual({});
    expect(fieldErrors(new Error('x'))).toEqual({});
  });
});

describe('hasCode', () => {
  it('matches an API error by its code', () => {
    expect(hasCode(apiError(ErrorCode.INVALID_TOKEN), ErrorCode.INVALID_TOKEN)).toBe(true);
    expect(hasCode(apiError(ErrorCode.INVALID_TOKEN), ErrorCode.RATE_LIMITED)).toBe(false);
    expect(hasCode(new Error('x'), ErrorCode.INVALID_TOKEN)).toBe(false);
  });
});

describe('listErrorMessage (Plan 3b rule 4)', () => {
  it('says a missing item was already removed', () => {
    expect(listErrorMessage(apiError(ErrorCode.NOT_FOUND, { status: 404 }))).toBe(ITEM_GONE);
    expect(ITEM_GONE).toBe('That item was already removed, so we’ve reloaded your list.');
  });

  it('explains a stale order and a full list', () => {
    expect(listErrorMessage(apiError(ErrorCode.ORDER_CONFLICT, { status: 409 }))).toBe(
      'Your list changed on another device, so we’ve reloaded it.',
    );
    expect(listErrorMessage(apiError(ErrorCode.LIST_FULL, { status: 422 }))).toBe(
      'Your list is full: 200 items is the most it can hold.',
    );
  });

  it('falls back to errorMessage for everything else', () => {
    expect(listErrorMessage(new TypeError('Failed to fetch'))).toBe(
      "We couldn't reach Hanker. Check your connection and try again.",
    );
  });
});
