import { describe, expect, it } from 'vitest';
import { HealthResponseSchema } from './health.js';

describe('HealthResponseSchema', () => {
  it('accepts an ok response', () => {
    const body = { status: 'ok', sha: 'abc123' };
    expect(HealthResponseSchema.parse(body)).toEqual(body);
  });

  it('rejects unknown statuses', () => {
    expect(HealthResponseSchema.safeParse({ status: 'meh', sha: 'abc123' }).success).toBe(false);
  });
});
