import {
  ErrorCode,
  ProblemSchema,
  TagSchema,
  TagSuggestionsResponseSchema,
} from '@wishlist/contracts';
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

const suggest = (cookie: string | undefined, body: object) =>
  client(t.app, cookie).post('/wishlist/tag-suggestions', body);

async function makeTag(cookie: string, name: string): Promise<string> {
  const res = await client(t.app, cookie).post('/wishlist/tags', { name });
  return TagSchema.parse(res.body).id;
}

describe('POST /wishlist/tag-suggestions (tag suggestions design §5.2)', () => {
  it('answers existing tags by id first, then new names, and sends only what it should', async () => {
    const ada = await owner();
    const kitchen = await makeTag(ada, 'Kitchen');
    t.suggester.next = { ok: true, names: ['Coffee', 'kitchen'] };
    const res = await suggest(ada, {
      title: 'Stovetop kettle',
      note: 'The blue one',
      url: 'https://shop.example/kettle?ref=1',
      description: 'Kitchenware',
    });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(TagSuggestionsResponseSchema.parse(res.body)).toEqual({
      suggestions: [{ id: kitchen }, { name: 'Coffee' }],
    });
    expect(t.suggester.inputs).toEqual([
      {
        title: 'Stovetop kettle',
        note: 'The blue one',
        host: 'shop.example',
        description: 'Kitchenware',
        tagNames: ['Kitchen'],
      },
    ]);
    expect(t.suggester.inputs[0]).not.toHaveProperty('url');
  });

  it('leaves a null note and an unparseable link out of what it sends', async () => {
    const ada = await owner();
    await suggest(ada, { title: 'Kettle', note: null, url: 'not a url' });
    expect(t.suggester.inputs).toEqual([{ title: 'Kettle', tagNames: [] }]);
  });

  it('does not suggest a tag the item already has', async () => {
    const ada = await owner();
    const kitchen = await makeTag(ada, 'Kitchen');
    t.suggester.next = { ok: true, names: ['Kitchen', 'Coffee'] };
    const res = await suggest(ada, { title: 'Kettle', tagIds: [kitchen] });
    expect(res.body).toEqual({ suggestions: [{ name: 'Coffee' }] });
  });

  it('ignores a tagId that isn’t on the list (ruling 4)', async () => {
    const ada = await owner();
    t.suggester.next = { ok: true, names: ['Coffee'] };
    const res = await suggest(ada, {
      title: 'Kettle',
      tagIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    });
    expect([res.status, res.body]).toEqual([200, { suggestions: [{ name: 'Coffee' }] }]);
  });

  it('is 200 with nothing when the suggester fails', async () => {
    t.suggester.next = { ok: false, reason: 'TIMEOUT' };
    const res = await suggest(await owner(), { title: 'Kettle' });
    expect([res.status, res.body]).toEqual([200, { suggestions: [] }]);
  });

  it('answers nothing, without asking, once suggestions are turned off (Review Focus 4)', async () => {
    const ada = await owner();
    t.suggester.next = { ok: true, names: ['Coffee'] };
    const off = await client(t.app, ada).patch('/wishlist', { suggestTags: false });
    expect(off.status).toBe(200);
    const res = await suggest(ada, { title: 'Kettle' });
    expect([res.status, res.body]).toEqual([200, { suggestions: [] }]);
    expect(t.suggester.inputs).toEqual([]);

    await client(t.app, ada).patch('/wishlist', { suggestTags: true });
    const on = await suggest(ada, { title: 'Kettle' });
    expect(on.body).toEqual({ suggestions: [{ name: 'Coffee' }] });
  });

  it('still counts a call against the limit when suggestions are off (ruling 3)', async () => {
    const ada = await owner();
    await client(t.app, ada).patch('/wishlist', { suggestTags: false });
    for (let i = 0; i < 60; i++) expect((await suggest(ada, { title: 'Kettle' })).status).toBe(200);
    const limited = await suggest(ada, { title: 'Kettle' });
    expect([limited.status, codeOf(limited)]).toEqual([429, ErrorCode.RATE_LIMITED]);
  });

  it('answers nothing, without asking, for an item that already has ten tags (ruling 4)', async () => {
    const ada = await owner();
    const tagIds: string[] = [];
    for (let i = 0; i < 10; i++) tagIds.push(await makeTag(ada, `Tag ${i}`));
    t.suggester.next = { ok: true, names: ['Coffee'] };
    const res = await suggest(ada, { title: 'Kettle', tagIds });
    expect([res.status, res.body]).toEqual([200, { suggestions: [] }]);
    expect(t.suggester.inputs).toEqual([]);
  });

  it('drops new names when the list already has 50 tags, and keeps existing matches', async () => {
    const ada = await owner();
    let first = '';
    for (let i = 0; i < 50; i++) {
      const id = await makeTag(ada, `Tag ${i}`);
      if (i === 0) first = id;
    }
    t.suggester.next = { ok: true, names: ['Coffee', 'tag 0'] };
    const res = await suggest(ada, { title: 'Kettle' });
    expect(res.body).toEqual({ suggestions: [{ id: first }] });
    expect(t.suggester.inputs[0]?.tagNames).toHaveLength(50);
  });

  it.each([{}, { title: '' }, { title: 'Kettle', tagIds: ['not-a-uuid'] }])(
    'refuses %j with 400 (Plan 3a rule 6)',
    async (body) => {
      const res = await suggest(await owner(), body);
      expect([res.status, codeOf(res)]).toEqual([400, ErrorCode.VALIDATION_FAILED]);
      expect(t.suggester.inputs).toEqual([]);
    },
  );

  it('needs a verified owner', async () => {
    expect((await suggest(undefined, { title: 'Kettle' })).status).toBe(401);
    await signUp(t);
    const unverified = await suggest(await logIn(t), { title: 'Kettle' });
    expect([unverified.status, codeOf(unverified)]).toEqual([403, ErrorCode.EMAIL_NOT_VERIFIED]);
    expect(t.suggester.inputs).toEqual([]);
  });

  it('allows 60 an hour per owner, then 429 with Retry-After', async () => {
    const ada = await owner();
    for (let i = 0; i < 60; i++) {
      expect((await suggest(ada, { title: `Kettle ${i}` })).status).toBe(200);
    }
    const limited = await suggest(ada, { title: 'Kettle 61' });
    expect([limited.status, codeOf(limited)]).toEqual([429, ErrorCode.RATE_LIMITED]);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(t.suggester.inputs).toHaveLength(60);

    // Another owner has their own budget, and the hour passing restores Ada's.
    expect((await suggest(await owner(BOB), { title: 'Kettle' })).status).toBe(200);
    t.clock.advance(60 * 60 * 1000);
    expect((await suggest(ada, { title: 'Again' })).status).toBe(200);
  });
});
