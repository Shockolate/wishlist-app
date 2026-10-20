import type { ErrorEvent } from '@sentry/node';
import { describe, expect, it } from 'vitest';
import { scrubEvent } from './scrub-event.js';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';

describe('scrubEvent', () => {
  it('drops the request parts and the user, and redacts every string left', () => {
    const event = {
      type: undefined,
      message: `failed for /api/claims/${TOKEN}`,
      request: {
        url: `https://wishlist-api.vercel.app/api/claims/${TOKEN}`,
        cookies: { '__Host-session': 'secret' },
        headers: { cookie: '__Host-session=secret' },
        data: '{"password":"hunter2"}',
        query_string: `token=${'a'.repeat(43)}`,
      },
      user: { email: 'ada@example.com' },
      tags: { route: '/api/claims/:manageToken' },
      extra: { note: 'sent to ada@example.com' },
    } as unknown as ErrorEvent;
    const scrubbed = scrubEvent(event);
    const json = JSON.stringify(scrubbed);
    expect(json).not.toContain(TOKEN);
    expect(json).not.toContain('ada@example.com');
    expect(json).not.toContain('hunter2');
    expect(json).not.toContain('secret');
    expect(scrubbed?.user).toBeUndefined();
    expect(scrubbed?.request).toEqual({
      url: 'https://wishlist-api.vercel.app/api/claims/[redacted]',
    });
    expect(scrubbed?.tags).toEqual({ route: '/api/claims/:manageToken' });
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
