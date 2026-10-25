import type { NestExpressApplication } from '@nestjs/platform-express';
import { CLOCK } from '../../src/core/clock.js';
import type { Env } from '../../src/core/env.js';
import { EMAIL_SENDER } from '../../src/email/email-sender.js';
import { CRON_HEARTBEAT } from '../../src/ops/cron-heartbeat.js';
import { BREACHED_PASSWORD_CHECKER } from '../../src/security/breached-passwords.js';
import { CAPTCHA_VERIFIER } from '../../src/security/captcha.js';
import {
  FakeBreachedPasswords,
  FakeCaptcha,
  FakeClock,
  FakeCronHeartbeat,
  FakeEmailSender,
  FakeMetadataFetcher,
  FakeTagSuggester,
} from '../../src/testing/fakes.js';
import { TAG_SUGGESTER } from '../../src/tag-suggest/tag-suggester.js';
import { METADATA_FETCHER } from '../../src/unfurl/metadata-fetcher.js';
import { createTestApp } from './app.js';

export const TEST_START = new Date('2026-10-01T12:00:00.000Z');

export interface AuthTestApp {
  app: NestExpressApplication;
  clock: FakeClock;
  emails: FakeEmailSender;
  captcha: FakeCaptcha;
  breaches: FakeBreachedPasswords;
  unfurl: FakeMetadataFetcher;
  suggester: FakeTagSuggester;
  heartbeat: FakeCronHeartbeat;
  /** Rewinds the clock and clears every fake. Call it in beforeEach. */
  reset(): void;
}

/** The real AppModule against the test database, with every external port (spec §8) faked. */
export async function createAuthTestApp(
  databaseUrl: string,
  env: Partial<Env> = {},
): Promise<AuthTestApp> {
  const clock = new FakeClock(TEST_START);
  const emails = new FakeEmailSender();
  const captcha = new FakeCaptcha();
  const breaches = new FakeBreachedPasswords();
  const unfurl = new FakeMetadataFetcher();
  const suggester = new FakeTagSuggester();
  const heartbeat = new FakeCronHeartbeat();
  const app = await createTestApp({
    databaseUrl,
    env,
    override: (builder) =>
      builder
        .overrideProvider(CLOCK)
        .useValue(clock)
        .overrideProvider(EMAIL_SENDER)
        .useValue(emails)
        .overrideProvider(CAPTCHA_VERIFIER)
        .useValue(captcha)
        .overrideProvider(BREACHED_PASSWORD_CHECKER)
        .useValue(breaches)
        .overrideProvider(METADATA_FETCHER)
        .useValue(unfurl)
        .overrideProvider(TAG_SUGGESTER)
        .useValue(suggester)
        .overrideProvider(CRON_HEARTBEAT)
        .useValue(heartbeat),
  });
  return {
    app,
    clock,
    emails,
    captcha,
    breaches,
    unfurl,
    suggester,
    heartbeat,
    reset() {
      clock.set(TEST_START);
      emails.sent.length = 0;
      emails.failNext = false;
      captcha.verdict = 'passed';
      captcha.tokens.length = 0;
      breaches.breached.clear();
      breaches.checked.length = 0;
      unfurl.next = { failureReason: 'NO_METADATA' };
      unfurl.urls.length = 0;
      suggester.next = { ok: true, names: [] };
      suggester.inputs.length = 0;
      heartbeat.pings.length = 0;
    },
  };
}
