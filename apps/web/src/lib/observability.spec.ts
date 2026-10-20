import type { ErrorEvent } from '@sentry/browser';
import { describe, expect, it } from 'vitest';
import { scrubEvent, sentryIngestOrigin, shouldReportBoundaryError } from './observability';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';

describe('scrubEvent (browser-shaped events)', () => {
  it('redacts the page URL, an unhandled rejection and the user (Review Focus #1)', () => {
    const event = {
      type: undefined,
      request: { url: `https://hanker.dev/c/${TOKEN}`, headers: { 'User-Agent': 'x' } },
      exception: {
        values: [{ type: 'Error', value: `Request to /api/shared/${TOKEN}/items/x failed` }],
      },
      user: { ip_address: '203.0.113.7' },
    } as unknown as ErrorEvent;
    const scrubbed = scrubEvent(event);
    expect(JSON.stringify(scrubbed)).not.toContain(TOKEN);
    expect(scrubbed?.request).toEqual({ url: 'https://hanker.dev/c/[redacted]' });
    expect(scrubbed?.user).toBeUndefined();
  });

  it("cuts a failed query at its bound parameters and drops a thrown object's serialized fields", () => {
    const event = {
      exception: {
        values: [
          {
            type: 'DrizzleQueryError',
            value:
              'Failed query: insert into "users" ("email", "password_hash") values ($1, $2)\nparams: ada@example.com,$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
          },
          { type: 'Error', value: 'plain' },
        ],
      },
      extra: { __serialized__: { password: 'plainpw' }, note: 'kept' },
    } as unknown as ErrorEvent;
    const scrubbed = scrubEvent(event);
    expect(scrubbed?.exception?.values?.map((v) => v.value)).toEqual([
      'Failed query: insert into "users" ("email", "password_hash") values ($1, $2)',
      'plain',
    ]);
    expect(scrubbed?.extra).toEqual({ note: 'kept' });
    expect(JSON.stringify(scrubbed)).not.toContain('plainpw');
  });
});

describe('sentryIngestOrigin', () => {
  it('is exactly the DSN’s origin', () => {
    expect(sentryIngestOrigin('https://abc123@o456.ingest.us.sentry.io/789')).toBe(
      'https://o456.ingest.us.sentry.io',
    );
  });

  it('is undefined without a DSN, or with one that isn’t an https URL', () => {
    expect(sentryIngestOrigin(undefined)).toBeUndefined();
    expect(sentryIngestOrigin('')).toBeUndefined();
    expect(sentryIngestOrigin('not a url')).toBeUndefined();
    expect(sentryIngestOrigin('http://k@o1.ingest.us.sentry.io/1')).toBeUndefined();
  });
});

describe('shouldReportBoundaryError', () => {
  it('reports a client-side error, not one the server already reported (it has a digest)', () => {
    expect(shouldReportBoundaryError({})).toBe(true);
    expect(shouldReportBoundaryError({ digest: '123456789' })).toBe(false);
  });
});
