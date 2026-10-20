import { DrizzleQueryError } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SentryErrorReporter } from './sentry-error-reporter.js';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';
// @sentry/node doesn't export its Envelope type, so the fake transport keeps envelopes as unknown.
const envelopes: unknown[] = [];
let reporter: SentryErrorReporter;

beforeAll(() => {
  reporter = new SentryErrorReporter({
    dsn: 'https://public@o1.ingest.us.sentry.io/1',
    release: 'abc123',
    environment: 'production',
    transport: () => ({
      send: (envelope: unknown) => {
        envelopes.push(envelope);
        return Promise.resolve({});
      },
      flush: () => Promise.resolve(true),
    }),
  });
});

afterAll(() => reporter.close());

/** The event inside each envelope sent so far. */
const sentEvents = () =>
  envelopes.map(
    (envelope) => (envelope as [unknown, [[unknown, Record<string, unknown>]]])[1][0][1],
  );

describe('SentryErrorReporter (the real SDK, a fake transport)', () => {
  it('sends a scrubbed exception tagged with the request ID, grouped by route', async () => {
    function claim(password: string): never {
      throw new Error(`failed for /api/claims/${TOKEN} by ada@example.com (${password.length})`);
    }
    try {
      claim('hunter2');
    } catch (error) {
      reporter.captureException(error, { requestId: 'req-1', route: '/api/claims/:manageToken' });
    }
    await reporter.flush();
    const event = sentEvents().at(-1);
    const json = JSON.stringify(event);
    expect(json).not.toContain(TOKEN);
    expect(json).not.toContain('ada@example.com');
    expect(json).not.toContain('hunter2');
    expect(event).toMatchObject({
      level: 'error',
      release: 'abc123',
      environment: 'production',
      transaction: '/api/claims/:manageToken',
      tags: { requestId: 'req-1' },
    });
    expect(event?.user).toBeUndefined();
    expect(event?.request).toBeUndefined();
  });

  it('sends a warning as a message', async () => {
    reporter.captureWarning('captcha unavailable: siteverify answered HTTP 400', {
      requestId: 'req-2',
    });
    await reporter.flush();
    expect(sentEvents().at(-1)).toMatchObject({
      level: 'warning',
      message: 'captcha unavailable: siteverify answered HTTP 400',
      tags: { requestId: 'req-2' },
    });
  });

  it('sends no bound parameters when a failed query arrives as a cause', async () => {
    const failure = new DrizzleQueryError(
      'insert into "users" ("email", "password_hash") values ($1, $2)',
      ['ada@example.com', '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA'],
      new Error('duplicate key'),
    );
    reporter.captureException(new Error('outer', { cause: failure }));
    await reporter.flush();
    const json = JSON.stringify(sentEvents().at(-1));
    expect(json).not.toContain('ada@example.com');
    expect(json).not.toContain('argon2id');
    expect(json).toContain('insert into \\"users\\"');
  });
});
