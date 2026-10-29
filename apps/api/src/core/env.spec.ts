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

  it('reads BRIGHT_DATA_API_KEY, which is optional (retailer lookups §5.6)', () => {
    expect(parseEnv(base).BRIGHT_DATA_API_KEY).toBeUndefined();
    expect(parseEnv({ ...base, BRIGHT_DATA_API_KEY: 'k' }).BRIGHT_DATA_API_KEY).toBe('k');
    expect(() => parseEnv({ ...base, BRIGHT_DATA_API_KEY: '' })).toThrow(/BRIGHT_DATA_API_KEY/);
  });

  it('reads ETSY_API_KEY, which is optional (retailer lookups §5.6)', () => {
    expect(parseEnv(base).ETSY_API_KEY).toBeUndefined();
    expect(parseEnv({ ...base, ETSY_API_KEY: 'ks:secret' }).ETSY_API_KEY).toBe('ks:secret');
    expect(() => parseEnv({ ...base, ETSY_API_KEY: '' })).toThrow(/ETSY_API_KEY/);
  });

  describe('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_TOKEN (tag suggestions §5.5)', () => {
    const both = { CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_AI_TOKEN: 'tok' };

    it('are optional, and unset together', () => {
      const env = parseEnv(base);
      expect(env.CLOUDFLARE_ACCOUNT_ID).toBeUndefined();
      expect(env.CLOUDFLARE_AI_TOKEN).toBeUndefined();
    });

    it('are read when both are set', () => {
      const env = parseEnv({ ...base, ...both });
      expect(env.CLOUDFLARE_ACCOUNT_ID).toBe('acct');
      expect(env.CLOUDFLARE_AI_TOKEN).toBe('tok');
    });

    it('refuse to be set one without the other', () => {
      expect(() => parseEnv({ ...base, CLOUDFLARE_ACCOUNT_ID: 'acct' })).toThrow(
        /set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_TOKEN together/,
      );
      expect(() => parseEnv({ ...base, CLOUDFLARE_AI_TOKEN: 'tok' })).toThrow(
        /set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_TOKEN together/,
      );
    });

    it('refuse an empty value', () => {
      expect(() => parseEnv({ ...base, ...both, CLOUDFLARE_AI_TOKEN: '' })).toThrow(
        /CLOUDFLARE_AI_TOKEN/,
      );
    });
  });

  describe('the Neon quota check (D105)', () => {
    const all = {
      NEON_PROJECT_ID: 'steep-dew-42117248',
      NEON_USAGE_API_KEY: 'napi_key',
      NEON_QUOTA_HEARTBEAT_URL: 'https://uptime.betterstack.com/api/v1/heartbeat/TOKEN',
    };

    it('is optional, and read when all three are set', () => {
      expect(parseEnv(base).NEON_USAGE_API_KEY).toBeUndefined();
      expect(parseEnv({ ...base, ...all })).toMatchObject(all);
    });

    it('refuses a partial set, which would ship the check silently off', () => {
      for (const name of Object.keys(all)) {
        expect(() => parseEnv({ ...base, ...all, [name]: undefined })).toThrow(
          /set NEON_PROJECT_ID, NEON_USAGE_API_KEY and NEON_QUOTA_HEARTBEAT_URL together/,
        );
      }
    });

    it('refuses an http heartbeat URL and a project ID that could change the path', () => {
      expect(() =>
        parseEnv({ ...base, ...all, NEON_QUOTA_HEARTBEAT_URL: 'http://example.com/hb' }),
      ).toThrow(/NEON_QUOTA_HEARTBEAT_URL/);
      expect(() => parseEnv({ ...base, ...all, NEON_PROJECT_ID: '../projects' })).toThrow(
        /NEON_PROJECT_ID/,
      );
    });
  });

  describe('CRON_HEARTBEAT_URL (D86)', () => {
    const url = 'https://uptime.betterstack.com/api/v1/heartbeat/SECRETTOKEN';

    it('is optional', () => {
      expect(parseEnv(base).CRON_HEARTBEAT_URL).toBeUndefined();
    });

    it('reads an https URL', () => {
      expect(parseEnv({ ...base, CRON_HEARTBEAT_URL: url }).CRON_HEARTBEAT_URL).toBe(url);
    });

    it('refuses http, so the token never travels in cleartext', () => {
      expect(() =>
        parseEnv({ ...base, CRON_HEARTBEAT_URL: url.replace('https:', 'http:') }),
      ).toThrow(/CRON_HEARTBEAT_URL/);
    });

    it('refuses something that is not a URL, without echoing it', () => {
      expect(() => parseEnv({ ...base, CRON_HEARTBEAT_URL: 'not a url SECRETTOKEN' })).toThrow(
        /CRON_HEARTBEAT_URL/,
      );
      expect(() => parseEnv({ ...base, CRON_HEARTBEAT_URL: 'not a url SECRETTOKEN' })).not.toThrow(
        /SECRETTOKEN/,
      );
    });
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

  it('refuses to only log account emails in production once sign-up can send them (Plan 2b rule 15)', () => {
    const live = { ...base, VERCEL_ENV: 'production', TURNSTILE_SECRET_KEY: 'x' };
    expect(() => parseEnv(live)).toThrow(/EMAIL_TRANSPORT/);
    expect(
      parseEnv({ ...live, EMAIL_TRANSPORT: 'resend', RESEND_API_KEY: 're_test' }).EMAIL_TRANSPORT,
    ).toBe('resend');
  });

  it('still boots dark production, and previews on the log transport', () => {
    expect(parseEnv({ ...base, VERCEL_ENV: 'production' }).EMAIL_TRANSPORT).toBe('log');
    expect(
      parseEnv({ ...base, VERCEL_ENV: 'preview', TURNSTILE_SECRET_KEY: 'x' }).EMAIL_TRANSPORT,
    ).toBe('log');
  });
});
