import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.js';

const DATABASE_URL = 'postgres://wishlist:wishlist@localhost:54329/wishlist';

describe('parseEnv', () => {
  it('applies defaults for optional settings', () => {
    expect(parseEnv({ DATABASE_URL })).toEqual({
      NODE_ENV: 'development',
      PORT: 3001,
      GIT_SHA: 'dev',
      DATABASE_URL,
    });
  });

  it('coerces PORT from its string form', () => {
    expect(parseEnv({ DATABASE_URL, PORT: '4000' }).PORT).toBe(4000);
  });

  it('names the offending variable when the environment is invalid', () => {
    expect(() => parseEnv({ DATABASE_URL, PORT: 'not-a-port' })).toThrow(/PORT/);
  });

  it('requires a postgres DATABASE_URL', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ DATABASE_URL: 'mysql://nope' })).toThrow(/DATABASE_URL/);
  });
});
