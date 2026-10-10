import { ErrorCode, MeResponseSchema, ProblemSchema } from '@wishlist/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SUBJECTS } from '../src/auth/auth-emails.js';
import { ADA, lastEmail, logIn, signUp, signUpVerified, TURNSTILE_OK } from './support/accounts.js';
import { createAuthTestApp, type AuthTestApp } from './support/auth-app.js';
import { client, linkToken, type ApiResponse } from './support/client.js';
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
const requestReset = (email: string) =>
  client(t.app).post('/auth/password-reset/request', { email, turnstileToken: TURNSTILE_OK });
const confirm = (token: string, newPassword = NEW_PASSWORD) =>
  client(t.app).post('/auth/password-reset/confirm', { token, newPassword });
const resetToken = () => linkToken(lastEmail(t, ADA.email, SUBJECTS.passwordReset).text);
const login = (password: string) =>
  client(t.app).post('/auth/login', { email: ADA.email, password });

describe('password reset (spec §5)', () => {
  it('emails a link to a known address and nothing to an unknown one, with identical responses (spec §8)', async () => {
    await signUpVerified(t);
    const known = await requestReset(ADA.email);
    const unknown = await requestReset('nobody@example.com');
    expect([known.status, known.text]).toEqual([202, '']);
    expect([unknown.status, unknown.text]).toEqual([known.status, known.text]);
    expect(t.emails.sent.filter((m) => m.subject === SUBJECTS.passwordReset)).toHaveLength(1);
  });

  it("sets the new password and revokes every session, including the requester's", async () => {
    await signUpVerified(t);
    const laptop = await logIn(t);
    const phone = await logIn(t);
    await requestReset(ADA.email);

    expect((await confirm(resetToken())).status).toBe(204);

    for (const cookie of [laptop, phone]) {
      expect((await client(t.app, cookie).get('/me')).status).toBe(401);
    }
    expect((await login(ADA.password)).status).toBe(401);
    expect((await login(NEW_PASSWORD)).status).toBe(204);
  });

  it('verifies an unverified address, because the reset proves the person reads that inbox', async () => {
    await signUp(t);
    await requestReset(ADA.email);
    await confirm(resetToken());
    const me = await client(
      t.app,
      await logIn(t, { email: ADA.email, password: NEW_PASSWORD }),
    ).get('/me');
    expect(MeResponseSchema.parse(me.body).emailVerified).toBe(true);
  });

  it('works once', async () => {
    await signUpVerified(t);
    await requestReset(ADA.email);
    const token = resetToken();
    expect((await confirm(token)).status).toBe(204);
    const again = await confirm(token, 'yet another passphrase 3');
    expect([again.status, codeOf(again)]).toEqual([400, ErrorCode.INVALID_TOKEN]);
  });

  it('expires after an hour', async () => {
    await signUpVerified(t);
    await requestReset(ADA.email);
    t.clock.advance(60 * 60 * 1000 + 1);
    expect(codeOf(await confirm(resetToken()))).toBe(ErrorCode.INVALID_TOKEN);
  });

  it('retires the previous link when a new one is requested', async () => {
    await signUpVerified(t);
    await requestReset(ADA.email);
    const first = resetToken();
    await requestReset(ADA.email);
    const second = resetToken();
    expect(codeOf(await confirm(first))).toBe(ErrorCode.INVALID_TOKEN);
    expect((await confirm(second)).status).toBe(204);
  });

  it('refuses a breached new password and leaves the link usable', async () => {
    await signUpVerified(t);
    await requestReset(ADA.email);
    t.breaches.breached.add(NEW_PASSWORD);
    expect(codeOf(await confirm(resetToken()))).toBe(ErrorCode.PASSWORD_BREACHED);
    expect((await confirm(resetToken(), 'an unbreached passphrase 4')).status).toBe(204);
  });

  it('rejects a made-up token before any breach check or hashing', async () => {
    const res = await confirm('A'.repeat(43));
    expect(codeOf(res)).toBe(ErrorCode.INVALID_TOKEN);
    expect(t.breaches.checked).toEqual([]);
  });

  it('needs a passing Turnstile to request a link', async () => {
    await signUpVerified(t);
    t.captcha.verdict = 'failed';
    expect(codeOf(await requestReset(ADA.email))).toBe(ErrorCode.CAPTCHA_FAILED);
    expect(t.emails.sent.filter((m) => m.subject === SUBJECTS.passwordReset)).toHaveLength(0);
  });
});
