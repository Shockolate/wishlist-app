import { ErrorCode, MeResponseSchema, ProblemSchema } from '@wishlist/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SUBJECTS } from '../src/auth/auth-emails.js';
import { SESSION_COOKIE } from '../src/auth/session-cookie.js';
import { ADA, lastEmail, logIn, signUpVerified, TURNSTILE_OK } from './support/accounts.js';
import { createAuthTestApp, type AuthTestApp } from './support/auth-app.js';
import { client, linkToken, setCookies, type ApiResponse } from './support/client.js';
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

const NEW_PASSWORD = 'a brand new passphrase 2';
const codeOf = (res: ApiResponse) => ProblemSchema.parse(res.body).code;
const count = async (table: string) =>
  Number((await db.pool.query<{ n: string }>(`select count(*) as n from ${table}`)).rows[0]?.n);
const login = (password: string) =>
  client(t.app).post('/auth/login', { email: ADA.email, password });

describe('PATCH /me (spec §5)', () => {
  it('renames the user', async () => {
    await signUpVerified(t);
    const cookie = await logIn(t);
    const res = await client(t.app, cookie).patch('/me', { displayName: '  Ada L. ' });
    expect(res.status).toBe(200);
    expect(MeResponseSchema.parse(res.body).displayName).toBe('Ada L.');
    expect(MeResponseSchema.parse((await client(t.app, cookie).get('/me')).body).displayName).toBe(
      'Ada L.',
    );
  });

  it('validates the display name', async () => {
    await signUpVerified(t);
    const res = await client(t.app, await logIn(t)).patch('/me', { displayName: '   ' });
    expect(codeOf(res)).toBe(ErrorCode.VALIDATION_FAILED);
  });
});

describe('/me needs a session', () => {
  it('answers 401 to every account endpoint without one', async () => {
    const anonymous = client(t.app);
    for (const res of [
      await anonymous.patch('/me', { displayName: 'X' }),
      await anonymous.post('/me/password', { currentPassword: 'x', newPassword: NEW_PASSWORD }),
      await anonymous.delete('/me', { password: 'x' }),
    ]) {
      expect([res.status, codeOf(res)]).toEqual([401, ErrorCode.UNAUTHENTICATED]);
    }
  });
});

describe('POST /me/password (spec §5)', () => {
  const change = (cookie: string, currentPassword: string, newPassword = NEW_PASSWORD) =>
    client(t.app, cookie).post('/me/password', { currentPassword, newPassword });

  it('retires outstanding reset links, so one sent before the change cannot undo it (rule 18)', async () => {
    await signUpVerified(t);
    const cookie = await logIn(t);
    await client(t.app).post('/auth/password-reset/request', {
      email: ADA.email,
      turnstileToken: TURNSTILE_OK,
    });
    const link = linkToken(lastEmail(t, ADA.email, SUBJECTS.passwordReset).text);

    expect((await change(cookie, ADA.password)).status).toBe(204);

    const res = await client(t.app).post('/auth/password-reset/confirm', {
      token: link,
      newPassword: 'yet another passphrase 3',
    });
    expect([res.status, codeOf(res)]).toEqual([400, ErrorCode.INVALID_TOKEN]);
  });

  it('keeps this session and revokes every other one', async () => {
    await signUpVerified(t);
    const laptop = await logIn(t);
    const phone = await logIn(t);

    expect((await change(laptop, ADA.password)).status).toBe(204);

    expect((await client(t.app, laptop).get('/me')).status).toBe(200);
    expect((await client(t.app, phone).get('/me')).status).toBe(401);
    expect((await login(ADA.password)).status).toBe(401);
    expect((await login(NEW_PASSWORD)).status).toBe(204);
  });

  it('refuses a wrong current password with 403 and changes nothing', async () => {
    await signUpVerified(t);
    const laptop = await logIn(t);
    const phone = await logIn(t);
    const res = await change(laptop, 'not my password');
    expect([res.status, codeOf(res)]).toEqual([403, ErrorCode.INVALID_CREDENTIALS]);
    expect((await client(t.app, phone).get('/me')).status).toBe(200);
    expect((await login(ADA.password)).status).toBe(204);
  });

  it('refuses a breached new password', async () => {
    await signUpVerified(t);
    t.breaches.breached.add(NEW_PASSWORD);
    expect(codeOf(await change(await logIn(t), ADA.password))).toBe(ErrorCode.PASSWORD_BREACHED);
  });

  it('counts confirmations against the login limit, so a stolen session cannot brute-force the password', async () => {
    await signUpVerified(t);
    const cookie = await logIn(t); // the first of the 10 hits allowed per 15 minutes
    for (let i = 0; i < 9; i++) expect((await change(cookie, 'guess')).status).toBe(403);
    expect((await change(cookie, 'guess')).status).toBe(429);
  });
});

describe('DELETE /me (spec §5)', () => {
  it('refuses a wrong password and keeps the account', async () => {
    await signUpVerified(t);
    const cookie = await logIn(t);
    const res = await client(t.app, cookie).delete('/me', { password: 'not my password' });
    expect([res.status, codeOf(res)]).toEqual([403, ErrorCode.INVALID_CREDENTIALS]);
    expect((await client(t.app, cookie).get('/me')).status).toBe(200);
  });

  it('deletes the account and everything it owns, signs out every device, and clears the cookie', async () => {
    await signUpVerified(t);
    const laptop = await logIn(t);
    const phone = await logIn(t);

    const res = await client(t.app, laptop).delete('/me', { password: ADA.password });
    expect(res.status).toBe(204);
    expect(setCookies(res)[0]).toMatch(
      new RegExp(`^${SESSION_COOKIE}=; Path=/; Expires=Thu, 01 Jan 1970`),
    );

    for (const cookie of [laptop, phone]) {
      expect((await client(t.app, cookie).get('/me')).status).toBe(401);
    }
    for (const table of ['users', 'wishlists', 'sessions', 'email_tokens']) {
      expect(await count(table)).toBe(0);
    }
    expect((await login(ADA.password)).status).toBe(401);
  });
});
