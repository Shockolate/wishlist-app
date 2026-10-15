import { describe, expect, it } from 'vitest';
import { isUniqueViolation } from './pg-errors.js';

const pg = (code: string, constraint?: string) =>
  Object.assign(new Error('duplicate key'), { code, constraint });

describe('isUniqueViolation', () => {
  it('recognizes Postgres’s unique_violation on the named constraint', () => {
    expect(
      isUniqueViolation(
        pg('23505', 'claims_manage_token_hash_unique'),
        'claims_manage_token_hash_unique',
      ),
    ).toBe(true);
  });

  it('looks through the error Drizzle wraps it in', () => {
    const wrapped = new Error('Failed query', {
      cause: pg('23505', 'claims_manage_token_hash_unique'),
    });
    expect(isUniqueViolation(wrapped, 'claims_manage_token_hash_unique')).toBe(true);
  });

  it('ignores another constraint, another code, and things that are not errors', () => {
    expect(
      isUniqueViolation(pg('23505', 'users_email_unique'), 'claims_manage_token_hash_unique'),
    ).toBe(false);
    expect(
      isUniqueViolation(
        pg('23503', 'claims_manage_token_hash_unique'),
        'claims_manage_token_hash_unique',
      ),
    ).toBe(false);
    expect(isUniqueViolation(undefined, 'x')).toBe(false);
    expect(isUniqueViolation('23505', 'x')).toBe(false);
  });
});
