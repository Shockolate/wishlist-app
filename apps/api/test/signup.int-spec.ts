import { ErrorCode, ProblemSchema } from '@wishlist/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SUBJECTS } from '../src/auth/auth-emails.js';
import { TEST_APP_ORIGIN } from '../src/testing/test-env.js';
import { ADA, lastEmail, signUp, TURNSTILE_OK } from './support/accounts.js';
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

const SIGNUP = { ...ADA, turnstileToken: TURNSTILE_OK };
const codeOf = (res: ApiResponse) => ProblemSchema.parse(res.body).code;
const count = async (table: string) =>
  Number((await db.pool.query<{ n: string }>(`select count(*) as n from ${table}`)).rows[0]?.n);

describe('POST /auth/signup (spec §5)', () => {
  it('creates the account and its wishlist, and emails a verification link', async () => {
    const res = await client(t.app).post('/auth/signup', SIGNUP);
    expect(res.status).toBe(202);
    expect(res.text).toBe('');

    const { rows } = await db.pool.query(
      `select u.email, u.display_name, u.email_verified_at, w.title, length(w.share_token) as share_length
         from users u join wishlists w on w.owner_id = u.id`,
    );
    expect(rows).toEqual([
      {
        email: 'ada@example.com',
        display_name: 'Ada',
        email_verified_at: null,
        title: "Ada's wishlist",
        share_length: 22,
      },
    ]);
    expect(t.emails.sent).toHaveLength(1);
    expect(lastEmail(t, ADA.email, SUBJECTS.verification).text).toContain(
      `${TEST_APP_ORIGIN}/verify-email?token=`,
    );
  });

  it('stores an argon2id hash, never the password', async () => {
    await client(t.app).post('/auth/signup', SIGNUP);
    const { rows } = await db.pool.query<{ password_hash: string }>(
      'select password_hash from users',
    );
    expect(rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
    expect(rows[0]?.password_hash).not.toContain(ADA.password);
  });

  it('answers an existing address, in any case, exactly like a new one, and emails the owner instead (enumeration resistance, spec §8)', async () => {
    const first = await client(t.app).post('/auth/signup', SIGNUP);
    const second = await client(t.app).post('/auth/signup', {
      ...SIGNUP,
      email: ' Ada@Example.COM ',
      displayName: 'Someone else',
    });
    expect(second.status).toBe(first.status);
    expect(second.text).toBe(first.text);
    expect(await count('users')).toBe(1);
    expect(t.emails.sent.map((m) => [m.to, m.subject])).toEqual([
      ['ada@example.com', SUBJECTS.verification],
      ['ada@example.com', SUBJECTS.accountExists],
    ]);
  });

  it('creates exactly one account when the same address signs up twice at once', async () => {
    const results = await Promise.all([
      client(t.app).post('/auth/signup', SIGNUP),
      client(t.app).post('/auth/signup', SIGNUP),
    ]);
    expect(results.map((r) => r.status)).toEqual([202, 202]);
    expect(await count('users')).toBe(1);
    expect(await count('wishlists')).toBe(1);
    expect(t.emails.sent.map((m) => m.subject).sort()).toEqual(
      [SUBJECTS.verification, SUBJECTS.accountExists].sort(),
    );
  });

  it('refuses a breached password before creating anything', async () => {
    t.breaches.breached.add(ADA.password);
    const res = await client(t.app).post('/auth/signup', SIGNUP);
    expect(res.status).toBe(400);
    expect(codeOf(res)).toBe(ErrorCode.PASSWORD_BREACHED);
    expect(await count('users')).toBe(0);
    expect(t.emails.sent).toHaveLength(0);
  });

  it('refuses when Turnstile rejects the token (400) or is unavailable (503)', async () => {
    t.captcha.verdict = 'failed';
    const failed = await client(t.app).post('/auth/signup', SIGNUP);
    expect([failed.status, codeOf(failed)]).toEqual([400, ErrorCode.CAPTCHA_FAILED]);

    t.captcha.verdict = 'unavailable';
    const unavailable = await client(t.app).post('/auth/signup', SIGNUP);
    expect([unavailable.status, codeOf(unavailable)]).toEqual([503, ErrorCode.CAPTCHA_UNAVAILABLE]);
    expect(await count('users')).toBe(0);
  });

  it('never calls Turnstile for an invalid body', async () => {
    const res = await client(t.app).post('/auth/signup', { ...SIGNUP, email: 'not-an-email' });
    expect(codeOf(res)).toBe(ErrorCode.VALIDATION_FAILED);
    expect(t.captcha.tokens).toHaveLength(0);
  });

  it('still answers 202 when the email provider is down (spec §9)', async () => {
    t.emails.failNext = true;
    const res = await client(t.app).post('/auth/signup', SIGNUP);
    expect(res.status).toBe(202);
    expect(await count('users')).toBe(1);
  });

  it('allows 3 emails an hour per address, shared with resend-verification, then 429 with Retry-After', async () => {
    await signUp(t);
    const resend = () =>
      client(t.app).post('/auth/resend-verification', {
        email: ADA.email,
        turnstileToken: TURNSTILE_OK,
      });
    expect((await resend()).status).toBe(202);
    expect((await resend()).status).toBe(202);
    const limited = await resend();
    expect(limited.status).toBe(429);
    expect(codeOf(limited)).toBe(ErrorCode.RATE_LIMITED);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });

  it("doesn't let failed captchas use up an address's budget", async () => {
    t.captcha.verdict = 'failed';
    for (let i = 0; i < 3; i++) await client(t.app).post('/auth/signup', SIGNUP);
    t.captcha.verdict = 'passed';
    expect((await client(t.app).post('/auth/signup', SIGNUP)).status).toBe(202);
  });

  it('allows 20 email-sending requests an hour per IP, across addresses', async () => {
    for (let i = 0; i < 20; i++) {
      const res = await client(t.app).post('/auth/signup', {
        ...SIGNUP,
        email: `user${i}@example.com`,
      });
      expect(res.status).toBe(202);
    }
    const limited = await client(t.app).post('/auth/signup', {
      ...SIGNUP,
      email: 'user20@example.com',
    });
    expect(limited.status).toBe(429);
  });

  it('leaves the unverified display name out of the verification email (rule 14)', async () => {
    await signUp(t, { ...ADA, displayName: 'evil.example/login' });
    const mail = lastEmail(t, ADA.email, SUBJECTS.verification);
    expect(mail.text).not.toContain('evil.example');
    expect(mail.html).not.toContain('evil.example');
  });
});

describe('POST /auth/verify-email (spec §5, §6.5)', () => {
  const tokenFor = (email = ADA.email) =>
    linkToken(lastEmail(t, email, SUBJECTS.verification).text);

  it('verifies the address with the emailed token, and only once', async () => {
    await signUp(t);
    const token = tokenFor();

    expect((await client(t.app).post('/auth/verify-email', { token })).status).toBe(204);
    const { rows } = await db.pool.query('select email_verified_at from users');
    expect(rows[0]?.email_verified_at).toBeInstanceOf(Date);

    const again = await client(t.app).post('/auth/verify-email', { token });
    expect([again.status, codeOf(again)]).toEqual([400, ErrorCode.INVALID_TOKEN]);
  });

  it('rejects a verification link after 24 hours', async () => {
    await signUp(t);
    t.clock.advance(24 * 60 * 60 * 1000 + 1);
    const res = await client(t.app).post('/auth/verify-email', { token: tokenFor() });
    expect(codeOf(res)).toBe(ErrorCode.INVALID_TOKEN);
  });

  it('rejects a token that was never issued, and a malformed one', async () => {
    const unknown = await client(t.app).post('/auth/verify-email', { token: 'A'.repeat(43) });
    expect([unknown.status, codeOf(unknown)]).toEqual([400, ErrorCode.INVALID_TOKEN]);
    const malformed = await client(t.app).post('/auth/verify-email', { token: 'short' });
    expect([malformed.status, codeOf(malformed)]).toEqual([400, ErrorCode.VALIDATION_FAILED]);
  });
});

describe('POST /auth/resend-verification (spec §5)', () => {
  const resend = (email: string) =>
    client(t.app).post('/auth/resend-verification', { email, turnstileToken: TURNSTILE_OK });

  it('sends a fresh link to an unverified account and retires the old one', async () => {
    await signUp(t);
    const oldToken = linkToken(lastEmail(t, ADA.email, SUBJECTS.verification).text);

    expect((await resend(ADA.email)).status).toBe(202);
    const newToken = linkToken(lastEmail(t, ADA.email, SUBJECTS.verification).text);
    expect(newToken).not.toBe(oldToken);

    expect(codeOf(await client(t.app).post('/auth/verify-email', { token: oldToken }))).toBe(
      ErrorCode.INVALID_TOKEN,
    );
    expect((await client(t.app).post('/auth/verify-email', { token: newToken })).status).toBe(204);
  });

  it('answers 202 and sends nothing for an unknown or an already-verified address', async () => {
    expect((await resend('nobody@example.com')).status).toBe(202);
    await signUp(t);
    await client(t.app).post('/auth/verify-email', {
      token: linkToken(lastEmail(t, ADA.email, SUBJECTS.verification).text),
    });
    expect((await resend(ADA.email)).status).toBe(202);
    expect(t.emails.sent).toHaveLength(1);
  });
});
