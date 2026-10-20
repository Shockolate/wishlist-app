import { DrizzleQueryError } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { reportable } from './reportable.js';

describe('reportable', () => {
  it('rebuilds a failed query without its bound parameters', () => {
    const driverError = new Error(
      'duplicate key value violates unique constraint "users_email_unique"',
    );
    const failure = new DrizzleQueryError(
      'insert into "users" ("email", "password_hash") values ($1, $2)',
      ['ada@example.com', '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA'],
      driverError,
    );
    const result = reportable(failure);
    expect(result).toBeInstanceOf(Error);
    const text = `${(result as Error).message}\n${(result as Error).stack ?? ''}`;
    expect(text).toContain('insert into "users"');
    expect(text).toContain('users_email_unique');
    expect(text).not.toContain('ada@example.com');
    expect(text).not.toContain('argon2id');
  });

  it('passes any other error through untouched', () => {
    const error = new TypeError('nope');
    expect(reportable(error)).toBe(error);
  });
});
