import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.js';

const DATABASE_URL = 'postgres://wishlist:wishlist@localhost:54329/wishlist';
const APP_ORIGIN = 'http://localhost:3000';
const base = { DATABASE_URL, APP_ORIGIN };

describe('parseEnv', () => {
  it('applies defaults for optional settings', () => {
    expect(parseEnv(base)).toEqual({
      NODE_ENV: 'development',
      PORT: 3001,
      GIT_SHA: 'dev',
      DATABASE_URL,
      APP_ORIGIN,
      EMAIL_TRANSPORT: 'log',
      EMAIL_FROM: 'Hanker <hanker@localhost>',
      MAILPIT_URL: 'http://localhost:8025',
    });
  });

  it('coerces PORT from its string form', () => {
    expect(parseEnv({ ...base, PORT: '4000' }).PORT).toBe(4000);
  });

  it('names the offending variable when the environment is invalid', () => {
    expect(() => parseEnv({ ...base, PORT: 'not-a-port' })).toThrow(/PORT/);
  });

  it('requires a postgres DATABASE_URL', () => {
    expect(() => parseEnv({ APP_ORIGIN })).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ APP_ORIGIN, DATABASE_URL: 'mysql://nope' })).toThrow(/DATABASE_URL/);
  });

  it('requires APP_ORIGIN as a bare origin, because the CSRF guard compares it exactly', () => {
    expect(() => parseEnv({ DATABASE_URL })).toThrow(/APP_ORIGIN/);
    expect(() => parseEnv({ DATABASE_URL, APP_ORIGIN: 'https://example.com/' })).toThrow(
      /APP_ORIGIN/,
    );
    expect(() => parseEnv({ DATABASE_URL, APP_ORIGIN: 'https://example.com/app' })).toThrow(
      /APP_ORIGIN/,
    );
  });

  it('requires RESEND_API_KEY when sending through Resend', () => {
    expect(() => parseEnv({ ...base, EMAIL_TRANSPORT: 'resend' })).toThrow(/RESEND_API_KEY/);
    expect(
      parseEnv({ ...base, EMAIL_TRANSPORT: 'resend', RESEND_API_KEY: 're_test' }).EMAIL_TRANSPORT,
    ).toBe('resend');
  });

  it('requires EMAIL_FROM in "Name <address>" form', () => {
    expect(() => parseEnv({ ...base, EMAIL_FROM: 'wishlist@example.com' })).toThrow(/EMAIL_FROM/);
  });

  it('rejects a CRON_SECRET shorter than 32 characters', () => {
    expect(() => parseEnv({ ...base, CRON_SECRET: 'short' })).toThrow(/CRON_SECRET/);
  });
});
