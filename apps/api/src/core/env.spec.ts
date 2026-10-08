import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.js';

describe('parseEnv', () => {
  it('applies defaults for optional settings', () => {
    expect(parseEnv({})).toEqual({ NODE_ENV: 'development', PORT: 3001, GIT_SHA: 'dev' });
  });

  it('coerces PORT from its string form', () => {
    expect(parseEnv({ PORT: '4000' }).PORT).toBe(4000);
  });

  it('names the offending variable when the environment is invalid', () => {
    expect(() => parseEnv({ PORT: 'not-a-port' })).toThrow(/PORT/);
  });
});
