import { ErrorCode, MeResponseSchema, ProblemSchema } from '@wishlist/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../src/auth/session-cookie.js';
import { ADA, logIn, signUp, signUpVerified } from './support/accounts.js';
import { createAuthTestApp, type AuthTestApp } from './support/auth-app.js';
import { client, sessionCookie, setCookies, type ApiResponse } from './support/client.js';
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

const problem = (res: ApiResponse) => ProblemSchema.parse(res.body);
const login = (email: string, password: string) =>
  client(t.app).post('/auth/login', { email, password });

describe('POST /auth/login (spec §5, §6.1, §6.4)', () => {
  it('logs in with the right password and sets the __Host- session cookie', async () => {
    await signUpVerified(t);
    const res = await login(ADA.email, ADA.password);
    expect(res.status).toBe(204);
    expect(setCookies(res)[0]).toMatch(
      new RegExp(
        `^${SESSION_COOKIE}=[A-Za-z0-9_-]{43}; Max-Age=2592000; Path=/; Expires=.+; HttpOnly; Secure; SameSite=Lax$`,
      ),
    );
    const me = await client(t.app, sessionCookie(res)).get('/me');
    expect(MeResponseSchema.parse(me.body)).toMatchObject({
      email: ADA.email,
      emailVerified: true,
    });
  });

  it('accepts the email in any case and with surrounding spaces', async () => {
    await signUpVerified(t);
    expect((await login(' ADA@Example.com ', ADA.password)).status).toBe(204);
  });

  it('lets an unverified user log in, and /me says so', async () => {
    await signUp(t);
    const me = await client(t.app, await logIn(t)).get('/me');
    expect(MeResponseSchema.parse(me.body).emailVerified).toBe(false);
  });

  it('answers a wrong password and an unknown email identically', async () => {
    await signUpVerified(t);
    const wrongPassword = await login(ADA.email, 'not the password');
    const unknownEmail = await login('nobody@example.com', ADA.password);
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(problem(wrongPassword).code).toBe(ErrorCode.INVALID_CREDENTIALS);
    expect(problem(unknownEmail).detail).toBe(problem(wrongPassword).detail);
    expect(setCookies(wrongPassword)).toEqual([]);
  });

  it('gives every login its own session', async () => {
    await signUpVerified(t);
    const laptop = await logIn(t);
    const phone = await logIn(t);
    expect(laptop).not.toBe(phone);
    await client(t.app, laptop).post('/auth/logout');
    expect((await client(t.app, phone).get('/me')).status).toBe(200);
  });

  it('allows 10 attempts per address per 15 minutes, then 429 even with the right password', async () => {
    await signUpVerified(t);
    for (let i = 0; i < 10; i++)
      expect((await login(ADA.email, 'wrong password')).status).toBe(401);
    const limited = await login(ADA.email, ADA.password);
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();

    t.clock.advance(15 * 60 * 1000);
    expect((await login(ADA.email, ADA.password)).status).toBe(204);
  });

  it('allows 50 attempts per IP per 15 minutes, across addresses', async () => {
    for (let i = 0; i < 50; i++) {
      expect((await login(`user${i}@example.com`, 'some password')).status).toBe(401);
    }
    expect((await login('user50@example.com', 'some password')).status).toBe(429);
  });
});
