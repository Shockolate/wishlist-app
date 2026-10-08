import { describe, expect, it } from 'vitest';
import { ProblemSchema } from './problem.js';

const base = {
  type: 'about:blank',
  title: 'Not Found',
  status: 404,
  code: 'NOT_FOUND',
  requestId: 'req-1',
};

describe('ProblemSchema', () => {
  it('accepts a minimal problem', () => {
    expect(ProblemSchema.parse(base)).toEqual(base);
  });

  it('keeps extension members so domain errors can carry extra fields', () => {
    const parsed = ProblemSchema.parse({
      ...base,
      status: 409,
      code: 'CLAIM_EXCEEDS_REMAINING',
      remaining: 1,
    });
    expect(parsed).toMatchObject({ remaining: 1 });
  });

  it('rejects a problem without a code', () => {
    const { code: _code, ...withoutCode } = base;
    expect(ProblemSchema.safeParse(withoutCode).success).toBe(false);
  });

  it('rejects non-error statuses', () => {
    expect(ProblemSchema.safeParse({ ...base, status: 200 }).success).toBe(false);
  });
});
