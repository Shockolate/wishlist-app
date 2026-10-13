import { ErrorCode, ProblemSchema, UnfurlResponseSchema } from '@wishlist/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADA, logIn, signUp, signUpVerified, type Account } from './support/accounts.js';
import { createAuthTestApp, type AuthTestApp } from './support/auth-app.js';
import { client, type ApiResponse } from './support/client.js';
import { openTestDatabase } from './support/database.js';

const db = openTestDatabase();
let t: AuthTestApp;

beforeAll(async () => {
  t = await createAuthTestApp(db.url);
});

afterAll(async () => {
  await t.app.close();
  await db.close();
});

beforeEach(async () => {
  await db.truncateAll();
  t.reset();
});

const BOB: Account = {
  email: 'bob@example.com',
  password: 'another fine passphrase 2',
  displayName: 'Bob',
};
const codeOf = (res: ApiResponse) => ProblemSchema.parse(res.body).code;

async function owner(account: Account = ADA): Promise<string> {
  await signUpVerified(t, account);
  return logIn(t, account);
}

const unfurl = (cookie: string | undefined, body: object) =>
  client(t.app, cookie).post('/wishlist/unfurl', body);

describe('POST /wishlist/unfurl (spec §5, §6.8)', () => {
  it('returns the prefill for the trimmed URL, and saves nothing', async () => {
    t.unfurl.next = {
      title: 'Stovetop kettle',
      imageUrl: 'https://cdn.example/kettle.jpg',
      priceText: '$40.00',
    };
    const res = await unfurl(await owner(), { url: ' https://shop.example/kettle ' });
    expect(res.status).toBe(200);
    expect(UnfurlResponseSchema.parse(res.body)).toEqual(t.unfurl.next);
    expect(t.unfurl.urls).toEqual(['https://shop.example/kettle']);
    const { rows } = await db.pool.query<{ n: string }>('select count(*) as n from items');
    expect(rows[0]?.n).toBe('0');
  });

  it('reports a failure as 200 with its reason (spec §9)', async () => {
    t.unfurl.next = { failureReason: 'BLOCKED_BY_SITE' };
    const res = await unfurl(await owner(), { url: 'https://shop.example/kettle' });
    expect([res.status, res.body]).toEqual([200, { failureReason: 'BLOCKED_BY_SITE' }]);
  });

  it.each([{}, { url: '' }, { url: 'a'.repeat(2049) }])(
    'refuses %j with 400 (Plan 3a rule 6)',
    async (body) => {
      const res = await unfurl(await owner(), body);
      expect([res.status, codeOf(res)]).toEqual([400, ErrorCode.VALIDATION_FAILED]);
      expect(t.unfurl.urls).toEqual([]);
    },
  );

  it('needs a verified owner', async () => {
    expect((await unfurl(undefined, { url: 'https://shop.example/' })).status).toBe(401);
    await signUp(t);
    const unverified = await unfurl(await logIn(t), { url: 'https://shop.example/' });
    expect([unverified.status, codeOf(unverified)]).toEqual([403, ErrorCode.EMAIL_NOT_VERIFIED]);
  });

  it('allows 60 an hour per owner, then 429 with Retry-After (spec §6.6)', async () => {
    const ada = await owner();
    for (let i = 0; i < 60; i++) {
      expect((await unfurl(ada, { url: `https://shop.example/${i}` })).status).toBe(200);
    }
    const limited = await unfurl(ada, { url: 'https://shop.example/61' });
    expect([limited.status, codeOf(limited)]).toEqual([429, ErrorCode.RATE_LIMITED]);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(t.unfurl.urls).toHaveLength(60);

    // Another owner has their own budget, and the hour passing restores Ada's.
    expect((await unfurl(await owner(BOB), { url: 'https://shop.example/' })).status).toBe(200);
    t.clock.advance(60 * 60 * 1000);
    expect((await unfurl(ada, { url: 'https://shop.example/again' })).status).toBe(200);
  });
});
