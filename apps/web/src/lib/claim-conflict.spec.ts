import { describe, expect, it } from 'vitest';
import { ApiError } from './api-client';
import { remainingFromConflict } from './claim-conflict';

const problem = (extra: Record<string, unknown>) =>
  new ApiError({
    type: 'about:blank',
    title: 'x',
    status: 409,
    code: 'CLAIM_EXCEEDS_REMAINING',
    requestId: 'r',
    ...extra,
  });

describe('remainingFromConflict', () => {
  it('reads what is left from the 409', () => {
    expect(remainingFromConflict(problem({ remaining: 3 }))).toBe(3);
  });

  it('says none left when the problem does not carry it, or is not an API error', () => {
    expect(remainingFromConflict(problem({}))).toBe(0);
    expect(remainingFromConflict(new Error('offline'))).toBe(0);
  });
});
