# Plan 2a: Auth API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The API side of accounts. It covers signup with email verification, login with database sessions, logout, password reset and change, display-name edits, account deletion, and a daily cleanup. All of it is CSRF-guarded, rate-limited and enumeration-resistant. It ships **dark**: the email-sending endpoints refuse requests until Plan 2b configures Turnstile and Resend in production.

**Architecture:**
- **Four new tables:** `users`, `sessions`, `email_tokens` and `wishlists`. Signup creates the wishlist (spec §2).
- **External services sit behind ports** (spec §8):
  - `EmailSender`, with log, Mailpit and Resend adapters;
  - `CaptchaVerifier` (Turnstile);
  - `BreachedPasswordChecker` (Have I Been Pwned);
  - `Clock`.

  Integration tests swap in fakes through Nest's dependency injection. Passwords use argon2id directly.
- **The HTTP layer:**
  - a `ZodValidationPipe` per request body;
  - a global `CsrfGuard` (`APP_GUARD`);
  - a `SessionGuard` on authenticated routes;
  - `RateLimiter.enforce()`, which answers `429` with `Retry-After`.
- **Email is queued in the background** (`waitUntil` on Vercel). Responses never wait on delivery, so their timing can't reveal whether an address has an account, and a provider outage can't fail a request.

**Tech Stack:**
- NestJS 12.1.2, Express 5, Drizzle 0.45.3 with `pg` 8.23.1, Zod 4.6.5.
- New: `@node-rs/argon2` 2.2.2 and `uuid` 14.0.2.
- Vitest 5 with Testcontainers (`postgres:17-alpine`, `axllent/mailpit:v1.31.4`), and supertest.
- Turnstile siteverify, the HIBP range API, Resend's REST API and Mailpit's HTTP send API, all through `fetch`. No SDKs.

**Spec:** [`docs/superpowers/specs/2026-10-07-wishlist-app-design.md`](../specs/2026-10-07-wishlist-app-design.md):
- §2 Actors and Wishlist;
- §4 (`users`, `sessions`, `email_tokens`, `wishlists`);
- §5 Auth;
- §6.1, §6.2, §6.4, §6.5, §6.6;
- §8 and §9;
- §10 "Monitoring and maintenance" (the daily cron).

It also respects the [CI trust-model addendum](../specs/2026-10-08-ci-secret-isolation-and-seeded-previews-design.md).

**Roadmap:** [`2026-10-07-roadmap.md`](2026-10-07-roadmap.md). Row 2 is split into **2a** (this plan) and **2b**.

**Not in this plan (Plan 2b):**
- web pages, the request proxy, CSP and headers (§6.9, §7);
- the Turnstile widget;
- the Mailpit-backed E2E golden path;
- the domain, DNS, Resend and Turnstile in production.

## Global Constraints

Everything from Plans 1 and 1b still applies:
- Node `>=24.15`, pnpm `12.10.1`, ESM, TypeScript `6.0.3`, ESLint `9.39.5`.
- Exact version pins, and Vitest.
- Conventional commits with the `Co-Authored-By` trailer, and PR bodies ending with the 🤖 line.
- The ⏸ CHECKPOINT rules.
- Explicit `@Inject(TOKEN)` on **every** constructor dependency, including classes. DI never relies on decorator metadata.

**Trust model (addendum 2026-10-08):**
- No new secrets go into GitHub. Runtime secrets live in the Vercel project's environment.
- `node scripts/workflow-policy.test.mjs` and `node scripts/workflow-policy.mutations.test.mjs` must keep passing.

**New dependencies, exact:** `@node-rs/argon2@2.2.2` and `uuid@14.0.2`, both in `apps/api`. Nothing else: the email and CAPTCHA adapters use `fetch`.

**Values fixed by the spec (copy them exactly):**

| Thing | Value |
|---|---|
| Session cookie | `__Host-session`, a 256-bit random base64url token (43 characters), `HttpOnly; Secure; SameSite=Lax; Path=/`, `Max-Age` 30 days (2592000 s) |
| Session expiry | Sliding; refreshed at most once an hour, and the cookie is reissued when it is |
| Token storage | Session and email tokens stored as SHA-256 hex. Share token: 128-bit base64url (22 characters), stored in plaintext |
| Password hashing | argon2id, `memoryCost: 19456` (19 MiB), `timeCost: 2`, `parallelism: 1` |
| Password length | 10–128 characters |
| Email tokens | Verify links last 24 hours and reset links 1 hour. Single use, and one live token per purpose |
| Display name | 1–50 characters. The wishlist title is `` `${displayName}'s wishlist` `` |
| Rate limits | `POST /auth/login`: 10 per 15 minutes per email, and 50 per 15 minutes per IP. Signup, resend-verification and reset-request: 3 per hour per email, and 20 per hour per IP |
| Cleanup | Unverified accounts older than 7 days are purged daily, along with expired email tokens, expired sessions and old rate-limit windows |

**Error handling:**
- Every error is problem+json with a stable `code`.
- An error's `detail` **never echoes what the caller sent**: not emails, passwords, tokens or display names.

**Tests and CSRF:** every state-changing request in a test sends `Origin: <APP_ORIGIN>` and `Content-Type: application/json`, through `test/support/client.ts`. The CSRF guard rejects anything else, and some tests check exactly that.

## Rulings this plan makes on gaps in the spec

The spec says what must happen but not every how. These are the plan's decisions, and the executor ledgers each one as it lands:

1. **Validation failures:** `400 VALIDATION_FAILED` with `errors[] {path, message}`. The pipe is applied per handler parameter (`@Body(new ZodValidationPipe(Schema))`), because a "global" pipe can't know which schema a route uses.
2. **A wrong current password** on `POST /me/password` or `DELETE /me` gets `403 INVALID_CREDENTIALS`. A `401` would look like "signed out" to the web client. These attempts share login's per-email bucket, so a stolen session can't brute-force the password.
3. **Shared email-sending buckets:** signup, resend-verification and reset-request share one "3 per hour" bucket per address and one "20 per hour" bucket per IP. Together they cap how much mail one inbox, or one IP, can trigger.
4. **Order of the abuse checks** on email-sending endpoints: per-IP limit, then Turnstile, then the per-address limit. A bot can't burn a victim's 3 emails an hour without solving a challenge.
5. **Email goes out in the background** through `Mailer.queue()`, using `waitUntil` on Vercel. A delivery failure is logged; it goes to Sentry in Plan 5.
6. **Rate-limit keys hash their identifying value** (SHA-256, first 32 hex characters). The `rate_limits` table never holds raw emails or IP addresses.
7. **Missing configuration fails closed:**
   - No `TURNSTILE_SECRET_KEY`: the email-sending endpoints answer `503 CAPTCHA_UNAVAILABLE` (spec §6.5, "refuse"). This is how 2a ships dark.
   - No `CRON_SECRET`: the cron endpoint answers `401` to everyone.
   - `APP_ORIGIN` is **required** at boot. Production already has it set.
8. **`EMAIL_TRANSPORT` gains a `mailpit` value** for local development and E2E (spec §10, Environments). It uses Mailpit's HTTP send API, so there's no SMTP dependency.
9. **`/me` and the account endpoints work for unverified users.** `EMAIL_NOT_VERIFIED` applies only to owner endpoints, which arrive in Plan 3.
10. **Reset confirm checks the token first,** before the breach check and the argon2 hash, so a made-up token can't make the server do that work.
11. **Logout is idempotent:** `204` and a cleared cookie, with or without a live session.

## Review Focus

These are the five failure modes the spec implies but no obvious test exercises, most likely first. Each one has a test in the task that owns it.

1. **Email case and whitespace.** Signing up as `" Ada@Example.COM "` and then logging in as `"ada@example.com"` must reach the same account. A second signup that differs only in case is the "already have an account" path, not a `500`. **Tests:** Task 7 (signup) and Task 8 (login).
2. **The same address signing up twice at once.** Exactly one user and one wishlist; both requests get `202`, and one of them sends the account-exists email. **Test:** Task 7.
3. **Token reuse and expiry.**
   - A second click on a verify link: `400 INVALID_TOKEN`.
   - A reset link used after an hour: invalid.
   - A new resend or reset request retires the previous link.

   **Tests:** Tasks 7 and 9.
4. **Dependency failures, each behaving as spec §9 says.**
   - The email provider throws: still `202`.
   - Turnstile is unreachable: `503`.
   - HIBP is unreachable: the check is skipped.

   **Tests:** Tasks 4 and 7.
5. **Revocation edges.**
   - An expired session row is rejected even before the cron deletes it.
   - A password change keeps the current session and kills the rest.
   - A reset kills every session, including the one that asked.

   **Tests:** Tasks 6, 9 and 10.

## Stacks

| Stack | Tasks | Branches (bottom → top) | Merges when |
|---|---|---|---|
| `auth-api-1` | 1–5 | `docs/plan-2a` (this plan) → `api/auth-contracts` → `api/auth-schema` → `api/http-security` → `api/security-adapters` → `api/email` | ⏸ After Task 5. These are foundations only: no endpoint changes behavior. Merging them early keeps stack 2 reviewable |
| `auth-api-2` | 6–12 | `api/sessions` → `api/signup` → `api/login` → `api/password-reset` → `api/account` → `api/daily-cron` → `docs/auth-api` | ⏸ Task 13 |

## File Structure

```
packages/contracts/src/
├── auth.ts                       NEW  /auth/* and /me request and response schemas
├── auth.spec.ts                  NEW
├── cron.ts                       NEW  CleanupResultSchema
├── error-codes.ts                MOD  + VALIDATION_FAILED, UNAUTHENTICATED, INVALID_CREDENTIALS, INVALID_TOKEN,
│                                      PASSWORD_BREACHED, CAPTCHA_FAILED, CAPTCHA_UNAVAILABLE, FORBIDDEN_ORIGIN
└── index.ts                      MOD
apps/api/
├── package.json                  MOD  + @node-rs/argon2, uuid
├── vercel.json                   MOD  daily cron
├── .env.example                  MOD  APP_ORIGIN, EMAIL_TRANSPORT, TURNSTILE_SECRET_KEY
├── drizzle/0001_auth.sql         NEW  generated, then two SET LOCAL timeout lines prepended
├── src/
│   ├── app.module.ts             MOD
│   ├── core/env.ts               MOD  APP_ORIGIN, EMAIL_*, RESEND_API_KEY, MAILPIT_URL, TURNSTILE_SECRET_KEY, CRON_SECRET
│   ├── core/ids.ts               NEW  UUIDv7
│   ├── db/schema.ts              MOD  users, sessions, email_tokens, wishlists
│   ├── db/database.module.ts     MOD  Transaction type
│   ├── http/app-error.ts         MOD  per-error response headers
│   ├── http/problem-details.filter.ts  MOD  applies them
│   ├── http/errors.ts            NEW  shared AppError factories
│   ├── http/zod-validation.pipe.ts     NEW
│   ├── http/client-ip.ts         NEW  clientIp() and @ClientIp()
│   ├── http/csrf.guard.ts        NEW
│   ├── http/http-security.module.ts    NEW  registers CsrfGuard as APP_GUARD
│   ├── rate-limit/rate-limiter.ts      MOD  enforce()
│   ├── rate-limit/keys.ts        NEW  rateLimitKey()
│   ├── security/tokens.ts        NEW  newToken(), hashToken()
│   ├── security/passwords.ts     NEW  argon2id, burnPasswordCheck()
│   ├── security/captcha.ts       NEW  CaptchaVerifier port, TurnstileVerifier
│   ├── security/breached-passwords.ts  NEW  BreachedPasswordChecker port, PwnedPasswordsChecker
│   ├── security/password-policy.ts     NEW
│   ├── security/security.module.ts     NEW
│   ├── email/email-sender.ts     NEW  EmailSender port, EmailMessage, parseAddress()
│   ├── email/log-email-sender.ts, mailpit-email-sender.ts, resend-email-sender.ts   NEW
│   ├── email/mailer.ts           NEW  background delivery
│   ├── email/email.module.ts     NEW  emailSenderFor(env)
│   ├── auth/session-cookie.ts    NEW
│   ├── auth/sessions.service.ts  NEW
│   ├── auth/session.guard.ts     NEW  SessionGuard, CurrentAuth, AuthContext
│   ├── auth/auth-errors.ts       NEW
│   ├── auth/rate-limits.ts       NEW  spec §6.6 rules
│   ├── auth/users.ts             NEW  findUserByEmail()
│   ├── auth/email-tokens.service.ts    NEW
│   ├── auth/email-gate.ts        NEW  IP limit, then Turnstile, then address limit
│   ├── auth/auth-emails.ts       NEW  the three emails
│   ├── auth/signup.service.ts, signup.controller.ts            NEW
│   ├── auth/login.service.ts, session.controller.ts            NEW
│   ├── auth/password-reset.service.ts, password-reset.controller.ts   NEW
│   ├── auth/account.service.ts, me.controller.ts               NEW
│   ├── auth/auth.module.ts       NEW
│   ├── ops/cleanup.service.ts, cron.controller.ts, ops.module.ts   NEW
│   └── testing/fakes.ts          NEW  FakeClock, FakeCaptcha, FakeBreachedPasswords, FakeEmailSender
└── test/
    ├── support/auth-app.ts       NEW  boots AppModule with every port faked
    ├── support/client.ts         NEW  browser-shaped requests, cookie and token helpers
    ├── support/accounts.ts       NEW  sign up, verify, log in
    └── auth-schema, mailpit-email-sender, sessions, signup, login, password-reset, account, cron .int-spec.ts   NEW
docker-compose.yml                MOD  + mailpit
e2e/playwright.config.ts          MOD  APP_ORIGIN for the API server
e2e/tests/smoke/smoke.spec.ts     MOD  /api/me answers 401 (read-only)
.github/workflows/preview.yml     MOD  Turnstile's always-pass test secret for API previews
docs/deployment.md, docs/development.md, spec, roadmap   MOD
```

**Integration test layout.** Every auth integration file:
- boots the real `AppModule` with `createAuthTestApp(db.url)`;
- truncates in `beforeEach`;
- and calls `t.reset()`, which rewinds the fake clock and clears the fakes.

Files share one database and run serially, as they already do.

---

### Task 1: Auth contracts

**Files:**
- Create: `packages/contracts/src/auth.ts`, `packages/contracts/src/cron.ts`
- Modify: `packages/contracts/src/error-codes.ts`, `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/auth.spec.ts`

**Interfaces:**
- **Consumes:** nothing new.
- **Produces:**
  - **Field schemas:** `EmailSchema`, which trims, lowercases, allows at most 254 characters and must be an email; `PasswordSchema` (10–128); `DisplayNameSchema` (trimmed, 1–50); `EmailTokenSchema` (`/^[A-Za-z0-9_-]{43}$/`).
  - **Request schemas:** `SignupRequestSchema`, `VerifyEmailRequestSchema`, `ResendVerificationRequestSchema`, `LoginRequestSchema`, `PasswordResetRequestSchema`, `PasswordResetConfirmRequestSchema`, `UpdateMeRequestSchema`, `ChangePasswordRequestSchema` and `DeleteMeRequestSchema`.
  - **Response schemas:** `MeResponseSchema` `{id, email, displayName, emailVerified}` and `CleanupResultSchema` `{unverifiedUsers, emailTokens, sessions, rateLimitWindows}`.
  - **Types:** a `z.infer` type for each, named without the `Schema` suffix (`SignupRequest`, `MeResponse`, `CleanupResult` and so on).
  - **New `ErrorCode` members:** `VALIDATION_FAILED`, `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `INVALID_TOKEN`, `PASSWORD_BREACHED`, `CAPTCHA_FAILED`, `CAPTCHA_UNAVAILABLE` and `FORBIDDEN_ORIGIN`.

- [ ] **Step 1: Start the stack layer**

```bash
git switch docs/plan-2a
gh stack add api/auth-contracts
```

- [ ] **Step 2: Write the failing tests**

`packages/contracts/src/auth.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  ChangePasswordRequestSchema,
  EmailSchema,
  EmailTokenSchema,
  LoginRequestSchema,
  MeResponseSchema,
  PasswordSchema,
  SignupRequestSchema,
} from './auth.js';

describe('EmailSchema', () => {
  it('trims and lowercases, because emails are stored and compared lowercased (spec §4)', () => {
    expect(EmailSchema.parse('  Ada@Example.COM ')).toBe('ada@example.com');
  });

  it('rejects something that is not an address', () => {
    expect(EmailSchema.safeParse('ada').success).toBe(false);
  });

  it('rejects addresses longer than 254 characters', () => {
    expect(EmailSchema.safeParse(`${'a'.repeat(250)}@x.io`).success).toBe(false);
  });
});

describe('PasswordSchema (spec §6.4: 10–128 characters)', () => {
  it.each([
    [9, false],
    [10, true],
    [128, true],
    [129, false],
  ])('a %i-character password is accepted: %s', (length, accepted) => {
    expect(PasswordSchema.safeParse('p'.repeat(length)).success).toBe(accepted);
  });
});

describe('SignupRequestSchema', () => {
  const valid = {
    email: 'ada@example.com',
    password: 'correct horse 1',
    displayName: ' Ada ',
    turnstileToken: 'token',
  };

  it('trims the display name', () => {
    expect(SignupRequestSchema.parse(valid).displayName).toBe('Ada');
  });

  it('requires a display name of 1–50 characters', () => {
    expect(SignupRequestSchema.safeParse({ ...valid, displayName: '   ' }).success).toBe(false);
    expect(SignupRequestSchema.safeParse({ ...valid, displayName: 'x'.repeat(51) }).success).toBe(
      false,
    );
  });

  it('requires a Turnstile token', () => {
    expect(SignupRequestSchema.safeParse({ ...valid, turnstileToken: '' }).success).toBe(false);
  });
});

describe('LoginRequestSchema', () => {
  it('accepts any non-empty password up to 128 characters, so login never reveals the policy', () => {
    expect(LoginRequestSchema.safeParse({ email: 'ada@example.com', password: 'short' }).success).toBe(
      true,
    );
    expect(
      LoginRequestSchema.safeParse({ email: 'ada@example.com', password: 'p'.repeat(129) }).success,
    ).toBe(false);
  });
});

describe('EmailTokenSchema', () => {
  it('accepts exactly a 256-bit base64url token (43 characters)', () => {
    expect(EmailTokenSchema.safeParse('A'.repeat(43)).success).toBe(true);
    expect(EmailTokenSchema.safeParse('A'.repeat(42)).success).toBe(false);
    expect(EmailTokenSchema.safeParse(`${'A'.repeat(42)}=`).success).toBe(false);
  });
});

describe('ChangePasswordRequestSchema', () => {
  it('applies the password policy to the new password only', () => {
    expect(
      ChangePasswordRequestSchema.safeParse({ currentPassword: 'old', newPassword: 'new password 1' })
        .success,
    ).toBe(true);
    expect(
      ChangePasswordRequestSchema.safeParse({ currentPassword: 'old', newPassword: 'short' }).success,
    ).toBe(false);
  });
});

describe('MeResponseSchema', () => {
  it('describes the signed-in user', () => {
    const me = {
      id: '0199a3b2-7c4d-7e5f-8a6b-9c0d1e2f3a4b',
      email: 'ada@example.com',
      displayName: 'Ada',
      emailVerified: false,
    };
    expect(MeResponseSchema.parse(me)).toEqual(me);
  });
});
```

Run: `pnpm --filter @wishlist/contracts test`
Expected: FAIL, because `./auth.js` can't be resolved.

- [ ] **Step 3: Implement the schemas and error codes**

`packages/contracts/src/auth.ts`:
```ts
import { z } from 'zod';

/** Emails are stored and compared lowercased (spec §4). 254 characters is the longest valid address. */
export const EmailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

/** Spec §6.4. The upper cap stops oversized inputs being used to burn hashing CPU. */
export const PasswordSchema = z.string().min(10).max(128);

/** For checking a password someone already has: never reveal the policy, but still cap the cost. */
const ExistingPasswordSchema = z.string().min(1).max(128);

export const DisplayNameSchema = z.string().trim().min(1).max(50);

/** An email-link token: 256 random bits, base64url without padding (spec §4). */
export const EmailTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid token');

const TurnstileTokenSchema = z.string().min(1).max(2048);

export const SignupRequestSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  displayName: DisplayNameSchema,
  turnstileToken: TurnstileTokenSchema,
});
export type SignupRequest = z.infer<typeof SignupRequestSchema>;

export const VerifyEmailRequestSchema = z.object({ token: EmailTokenSchema });
export type VerifyEmailRequest = z.infer<typeof VerifyEmailRequestSchema>;

export const ResendVerificationRequestSchema = z.object({
  email: EmailSchema,
  turnstileToken: TurnstileTokenSchema,
});
export type ResendVerificationRequest = z.infer<typeof ResendVerificationRequestSchema>;

export const LoginRequestSchema = z.object({ email: EmailSchema, password: ExistingPasswordSchema });
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const PasswordResetRequestSchema = z.object({
  email: EmailSchema,
  turnstileToken: TurnstileTokenSchema,
});
export type PasswordResetRequest = z.infer<typeof PasswordResetRequestSchema>;

export const PasswordResetConfirmRequestSchema = z.object({
  token: EmailTokenSchema,
  newPassword: PasswordSchema,
});
export type PasswordResetConfirmRequest = z.infer<typeof PasswordResetConfirmRequestSchema>;

export const MeResponseSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  emailVerified: z.boolean(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const UpdateMeRequestSchema = z.object({ displayName: DisplayNameSchema });
export type UpdateMeRequest = z.infer<typeof UpdateMeRequestSchema>;

export const ChangePasswordRequestSchema = z.object({
  currentPassword: ExistingPasswordSchema,
  newPassword: PasswordSchema,
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

export const DeleteMeRequestSchema = z.object({ password: ExistingPasswordSchema });
export type DeleteMeRequest = z.infer<typeof DeleteMeRequestSchema>;
```

`packages/contracts/src/cron.ts`:
```ts
import { z } from 'zod';

/** What the daily cleanup deleted (spec §10, "Monitoring and maintenance"). */
export const CleanupResultSchema = z.object({
  unverifiedUsers: z.number().int().nonnegative(),
  emailTokens: z.number().int().nonnegative(),
  sessions: z.number().int().nonnegative(),
  rateLimitWindows: z.number().int().nonnegative(),
});
export type CleanupResult = z.infer<typeof CleanupResultSchema>;
```

In `packages/contracts/src/error-codes.ts`, insert these members after `INTERNAL_ERROR: 'INTERNAL_ERROR',`:
```ts
  /** 400: the request body failed its schema. `errors[]` names each bad field (spec §5). */
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  /** 401: there's no live session. */
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  /** 401 at login; 403 when an authenticated request confirms the wrong password. */
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  /** 400: an email link's token is unknown, expired or already used. */
  INVALID_TOKEN: 'INVALID_TOKEN',
  /** 400: the new password appears in Have I Been Pwned (spec §6.4). */
  PASSWORD_BREACHED: 'PASSWORD_BREACHED',
  /** 400: Turnstile rejected the challenge token. */
  CAPTCHA_FAILED: 'CAPTCHA_FAILED',
  /** 503: Turnstile is unreachable or not configured, so email-sending endpoints refuse (spec §6.5). */
  CAPTCHA_UNAVAILABLE: 'CAPTCHA_UNAVAILABLE',
  /** 403: a state-changing request that didn't come from APP_ORIGIN (spec §6.2). */
  FORBIDDEN_ORIGIN: 'FORBIDDEN_ORIGIN',
```

`packages/contracts/src/index.ts`:
```ts
export * from './auth.js';
export * from './cron.js';
export * from './error-codes.js';
export * from './health.js';
export * from './problem.js';
```

Run: `pnpm --filter @wishlist/contracts test`
Expected: PASS, including the existing `health` and `problem` specs.

- [ ] **Step 4: Gate, commit and submit**

```bash
pnpm turbo run lint typecheck test build --filter=@wishlist/contracts
pnpm format:check
git add packages/contracts/src
git commit -F - <<'EOF'
feat(contracts): add auth request and response schemas and error codes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
gh stack submit --open
```

Expected: the gate passes, and the PR's checks pass.

---

### Task 2: The auth tables

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Create: `apps/api/drizzle/0001_auth.sql` and `apps/api/drizzle/meta/0001_snapshot.json`, both generated. `apps/api/drizzle/meta/_journal.json` is updated by the generator.
- Test: `apps/api/test/auth-schema.int-spec.ts`

**Interfaces:**
- **Consumes:** nothing new.
- **Produces Drizzle tables** in `src/db/schema.ts`:
  - `users`: `id`, `email`, `passwordHash`, `displayName`, `emailVerifiedAt`, `createdAt`, `updatedAt`.
  - `sessions`: `id`, `userId`, `createdAt`, `expiresAt`, `lastSeenAt`.
  - `emailTokens`: `id`, `userId`, `purpose`, `tokenHash`, `expiresAt`, `consumedAt`, `createdAt`.
  - `wishlists`: `id`, `ownerId`, `title`, `shareToken`, `showClaimsToOwner`, `createdAt`, `updatedAt`.
- **Also produces:** `EMAIL_TOKEN_PURPOSES` and `type EmailTokenPurpose = 'verify_email' | 'reset_password'`.
- **Constraint names the tests rely on:** `users_email_lower_key`, `wishlists_owner_id_unique` and `email_tokens_purpose_check`.

- [ ] **Step 1: Add the stack layer**

```bash
gh stack add api/auth-schema
```

- [ ] **Step 2: Write the failing integration test**

`apps/api/test/auth-schema.int-spec.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { openTestDatabase } from './support/database.js';

const db = openTestDatabase();
afterAll(() => db.close());
beforeEach(() => db.truncateAll());

const ADA = '0199a3b2-0000-7000-8000-000000000001';
const BOB = '0199a3b2-0000-7000-8000-000000000002';

function insertUser(id: string, email: string) {
  return db.pool.query(
    `insert into users (id, email, password_hash, display_name) values ($1, $2, 'x', 'Ada')`,
    [id, email],
  );
}

describe('auth tables (spec §4)', () => {
  it('rejects a second account whose email differs only in case', async () => {
    await insertUser(ADA, 'ada@example.com');
    await expect(insertUser(BOB, 'Ada@Example.com')).rejects.toThrow(/users_email_lower_key/);
  });

  it('gives each user at most one wishlist', async () => {
    await insertUser(ADA, 'ada@example.com');
    const insert = (id: string, shareToken: string) =>
      db.pool.query(
        `insert into wishlists (id, owner_id, title, share_token) values ($1, $2, 't', $3)`,
        [id, ADA, shareToken],
      );
    await insert('0199a3b2-0000-7000-8000-00000000000a', 'share-1');
    await expect(insert('0199a3b2-0000-7000-8000-00000000000b', 'share-2')).rejects.toThrow(
      /wishlists_owner_id_unique/,
    );
  });

  it('only accepts the two email-token purposes', async () => {
    await insertUser(ADA, 'ada@example.com');
    await expect(
      db.pool.query(
        `insert into email_tokens (id, user_id, purpose, token_hash, expires_at)
         values ($1, $2, 'magic_link', 'h', now())`,
        ['0199a3b2-0000-7000-8000-0000000000c1', ADA],
      ),
    ).rejects.toThrow(/email_tokens_purpose_check/);
  });

  it('cascades a user deletion to sessions, email tokens and the wishlist', async () => {
    await insertUser(ADA, 'ada@example.com');
    await db.pool.query(
      `insert into sessions (id, user_id, expires_at, last_seen_at) values ('s1', $1, now(), now())`,
      [ADA],
    );
    await db.pool.query(
      `insert into email_tokens (id, user_id, purpose, token_hash, expires_at)
       values ($1, $2, 'verify_email', 'h1', now())`,
      ['0199a3b2-0000-7000-8000-0000000000c1', ADA],
    );
    await db.pool.query(
      `insert into wishlists (id, owner_id, title, share_token) values ($1, $2, 't', 's')`,
      ['0199a3b2-0000-7000-8000-00000000000a', ADA],
    );

    await db.pool.query('delete from users where id = $1', [ADA]);

    const { rows } = await db.pool.query<{ n: string }>(
      `select (select count(*) from sessions) + (select count(*) from email_tokens)
            + (select count(*) from wishlists) as n`,
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });
});
```

Run: `pnpm --filter @wishlist/api exec vitest run --project integration test/auth-schema.int-spec.ts`
Expected: FAIL with `relation "users" does not exist`. Docker must be running.

- [ ] **Step 3: Add the tables to the Drizzle schema**

Replace `apps/api/src/db/schema.ts` with:
```ts
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const tz = { withTimezone: true } as const;

// A function, not a shared object: each table needs its own column builders.
const timestamps = () => ({
  createdAt: timestamp('created_at', tz).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', tz).notNull().defaultNow(),
});

/** Fixed-window counters for rate limiting (spec §4, §6.6): one row per key per window. */
export const rateLimits = pgTable(
  'rate_limits',
  {
    key: text('key').notNull(),
    windowStart: timestamp('window_start', tz).notNull(),
    count: integer('count').notNull(),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

/**
 * Accounts (spec §4). IDs are UUIDv7, generated by the application. Emails are stored lowercased,
 * and the unique index on lower(email) holds even if a write ever forgets to.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    email: text('email').notNull(),
    /** An argon2id PHC string. */
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', tz),
    ...timestamps(),
  },
  (t) => [uniqueIndex('users_email_lower_key').on(sql`lower(${t.email})`)],
);

/** Database sessions (spec §6.1). The id is SHA-256 of the cookie token, so a leak yields nothing usable. */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', tz).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', tz).notNull(),
    lastSeenAt: timestamp('last_seen_at', tz).notNull(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

export const EMAIL_TOKEN_PURPOSES = ['verify_email', 'reset_password'] as const;
export type EmailTokenPurpose = (typeof EMAIL_TOKEN_PURPOSES)[number];

/** Verify and reset links (spec §4, §6.5). Only the SHA-256 of each token is stored. */
export const emailTokens = pgTable(
  'email_tokens',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose', { enum: EMAIL_TOKEN_PURPOSES }).notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', tz).notNull(),
    consumedAt: timestamp('consumed_at', tz),
    createdAt: timestamp('created_at', tz).notNull().defaultNow(),
  },
  (t) => [
    index('email_tokens_user_id_idx').on(t.userId),
    check('email_tokens_purpose_check', sql`${t.purpose} in ('verify_email', 'reset_password')`),
  ],
);

/**
 * One list per user (spec §2, D4), enforced by the unique owner_id rather than by hanging items off
 * users. Signup creates it. The share token is plaintext by design: the owner must always be able
 * to copy the link (spec §4).
 */
export const wishlists = pgTable('wishlists', {
  id: uuid('id').primaryKey(),
  ownerId: uuid('owner_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  shareToken: text('share_token').notNull().unique(),
  showClaimsToOwner: boolean('show_claims_to_owner').notNull().default(false),
  ...timestamps(),
});
```

- [ ] **Step 4: Generate the migration and add lock timeouts**

```bash
pnpm --filter @wishlist/api db:generate --name auth
```

Expected: the generator creates `apps/api/drizzle/0001_auth.sql` and `meta/0001_snapshot.json`, and adds an `0001_auth` entry to `meta/_journal.json`. The SQL contains:
- `CREATE TABLE` for `users`, `sessions`, `email_tokens` and `wishlists`, the last two with their `UNIQUE` and `CHECK` constraints;
- three `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY … ON DELETE cascade` statements;
- `CREATE UNIQUE INDEX "users_email_lower_key" … (lower("email"))`, plus the two `user_id` indexes.

Read the file before going on. **Why the next step:** squawk (`migrations-lint`) requires a `lock_timeout` and a `statement_timeout` before the foreign-key `ALTER TABLE`s, which take `SHARE ROW EXCLUSIVE` locks. Drizzle runs each migration in a transaction, so `SET LOCAL` limits the timeouts to it. That was checked against squawk 2.67.0 with this repo's `.squawk.toml`: 0 issues.

```bash
python3 - <<'PY'
from pathlib import Path
p = Path('apps/api/drizzle/0001_auth.sql')
s = p.read_text()
assert not s.startswith('SET LOCAL'), 'already prepended'
p.write_text("SET LOCAL lock_timeout = '5s';--> statement-breakpoint\n"
             "SET LOCAL statement_timeout = '30s';--> statement-breakpoint\n" + s)
PY
npx --yes squawk-cli@2.67.0 apps/api/drizzle/0001_auth.sql
```

Expected: `Found 0 issues in 1 file`.

- [ ] **Step 5: Run the test**

Run: `pnpm --filter @wishlist/api exec vitest run --project integration test/auth-schema.int-spec.ts`
Expected: PASS, 4 tests. The integration global setup applies every committed migration, so `0001_auth` runs.

- [ ] **Step 6: Gate, commit and submit**

```bash
API_ORIGIN=http://localhost:3001 pnpm turbo run lint typecheck test build
pnpm turbo run test:integration --filter=@wishlist/api
pnpm format:check
git add apps/api/src/db/schema.ts apps/api/drizzle apps/api/test/auth-schema.int-spec.ts
git commit -F - <<'EOF'
feat(api): add the users, sessions, email_tokens and wishlists tables

Spec §4. The migration sets lock and statement timeouts so squawk accepts
its foreign keys.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
gh stack submit --open
```

Expected: the gate passes. The PR's `migrations-lint` check passes, as do `integration` and the rest. The PR's preview migrates `pr-<n>` from `preview-seed`.

---

### Task 3: HTTP security plumbing

**Files:**
- Modify: `apps/api/src/core/env.ts`, `apps/api/src/testing/test-env.ts`, `apps/api/.env.example`, `e2e/playwright.config.ts`
- Modify: `apps/api/src/http/app-error.ts`, `apps/api/src/http/problem-details.filter.ts`, `apps/api/src/rate-limit/rate-limiter.ts`, `apps/api/src/app.module.ts`
- Create: `apps/api/src/http/errors.ts`, `zod-validation.pipe.ts`, `client-ip.ts`, `csrf.guard.ts`, `http-security.module.ts`, and `apps/api/src/rate-limit/keys.ts`
- Test: `apps/api/src/core/env.spec.ts` (replaced) and `apps/api/src/http/http-pipeline.spec.ts` (extended)
- Test: `apps/api/src/http/zod-validation.pipe.spec.ts`, `client-ip.spec.ts`, `csrf.guard.spec.ts`, `apps/api/src/rate-limit/keys.spec.ts` (all new)
- Test: `apps/api/test/rate-limiter.int-spec.ts` (extended)

**Interfaces:**
- **Consumes:** `ErrorCode` and the auth schemas (Task 1).
- **Produces, environment:**
  - `Env` gains `APP_ORIGIN` (string), `EMAIL_TRANSPORT` (`'log' | 'mailpit' | 'resend'`), `EMAIL_FROM` and `MAILPIT_URL` (strings), and the optional `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY` and `CRON_SECRET`.
  - `TEST_APP_ORIGIN = 'http://localhost:3000'` from `src/testing/test-env.ts`.
- **Produces, errors:**
  - `new AppError(status, code, detail?, extras?, headers?)`; the filter sends `headers`.
  - Factories in `src/http/errors.ts`: `unauthenticated()`, `forbiddenOrigin()`, `unsupportedMediaType()`, `rateLimited(retryAfterSeconds)` and `validationFailed(errors)`.
- **Produces, request handling:**
  - `new ZodValidationPipe(schema)`.
  - `clientIp(req, onVercel)` and the `@ClientIp()` parameter decorator.
  - `CsrfGuard`, registered globally by `HttpSecurityModule`.
- **Produces, rate limiting:** `RateLimiter.enforce(key, rule): Promise<void>`, which throws `rateLimited`, and `rateLimitKey(scope, value)`.

- [ ] **Step 1: Add the stack layer**

```bash
gh stack add api/http-security
```

- [ ] **Step 2: Write the failing environment tests**

Replace `apps/api/src/core/env.spec.ts` with:
```ts
import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.js';

const DATABASE_URL = 'postgres://wishlist:wishlist@localhost:54329/wishlist';
const APP_ORIGIN = 'http://localhost:3000';
const base = { DATABASE_URL, APP_ORIGIN };

describe('parseEnv', () => {
  it('applies defaults for optional settings', () => {
    expect(parseEnv(base)).toEqual({
      NODE_ENV: 'development',
      PORT: 3001,
      GIT_SHA: 'dev',
      DATABASE_URL,
      APP_ORIGIN,
      EMAIL_TRANSPORT: 'log',
      EMAIL_FROM: 'Wishlist <wishlist@localhost>',
      MAILPIT_URL: 'http://localhost:8025',
    });
  });

  it('coerces PORT from its string form', () => {
    expect(parseEnv({ ...base, PORT: '4000' }).PORT).toBe(4000);
  });

  it('names the offending variable when the environment is invalid', () => {
    expect(() => parseEnv({ ...base, PORT: 'not-a-port' })).toThrow(/PORT/);
  });

  it('requires a postgres DATABASE_URL', () => {
    expect(() => parseEnv({ APP_ORIGIN })).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ APP_ORIGIN, DATABASE_URL: 'mysql://nope' })).toThrow(/DATABASE_URL/);
  });

  it('requires APP_ORIGIN as a bare origin, because the CSRF guard compares it exactly', () => {
    expect(() => parseEnv({ DATABASE_URL })).toThrow(/APP_ORIGIN/);
    expect(() => parseEnv({ DATABASE_URL, APP_ORIGIN: 'https://example.com/' })).toThrow(
      /APP_ORIGIN/,
    );
    expect(() => parseEnv({ DATABASE_URL, APP_ORIGIN: 'https://example.com/app' })).toThrow(
      /APP_ORIGIN/,
    );
  });

  it('requires RESEND_API_KEY when sending through Resend', () => {
    expect(() => parseEnv({ ...base, EMAIL_TRANSPORT: 'resend' })).toThrow(/RESEND_API_KEY/);
    expect(
      parseEnv({ ...base, EMAIL_TRANSPORT: 'resend', RESEND_API_KEY: 're_test' }).EMAIL_TRANSPORT,
    ).toBe('resend');
  });

  it('requires EMAIL_FROM in "Name <address>" form', () => {
    expect(() => parseEnv({ ...base, EMAIL_FROM: 'wishlist@example.com' })).toThrow(/EMAIL_FROM/);
  });

  it('rejects a CRON_SECRET shorter than 32 characters', () => {
    expect(() => parseEnv({ ...base, CRON_SECRET: 'short' })).toThrow(/CRON_SECRET/);
  });
});
```

Run: `pnpm --filter @wishlist/api exec vitest run --project unit src/core/env.spec.ts`
Expected: FAIL. The first test sees no email settings in the result, and `APP_ORIGIN` isn't required yet.

- [ ] **Step 3: Extend the environment**

Replace `apps/api/src/core/env.ts` with:
```ts
import { z } from 'zod';

/** A bare origin such as https://example.com: no path, query or trailing slash. */
const OriginSchema = z.string().refine((value) => {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}, 'must be a bare origin such as https://example.com');

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(0).max(65_535).default(3001),
    /** Commit the deployment was built from; set by the deploy pipelines. */
    GIT_SHA: z.string().min(1).default('dev'),
    DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection string'),
    /**
     * The web origin browsers use. The CSRF guard only accepts state-changing requests from it
     * (spec §6.2), and links in emails point at it.
     */
    APP_ORIGIN: OriginSchema,
    /** `log` prints emails (previews, tests), `mailpit` delivers locally, `resend` sends for real. */
    EMAIL_TRANSPORT: z.enum(['log', 'mailpit', 'resend']).default('log'),
    EMAIL_FROM: z
      .string()
      .regex(/^[^<>]+ <[^<>\s]+@[^<>\s]+>$/, 'must look like "Name <address@domain>"')
      .default('Wishlist <wishlist@localhost>'),
    RESEND_API_KEY: z.string().min(1).optional(),
    MAILPIT_URL: z.url().default('http://localhost:8025'),
    /** Unset means Turnstile is unavailable, so email-sending endpoints refuse (spec §6.5). */
    TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
    /** Vercel Cron sends it as a bearer token. Unset means the cron endpoint refuses everyone. */
    CRON_SECRET: z.string().min(32).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.EMAIL_TRANSPORT === 'resend' && !env.RESEND_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['RESEND_API_KEY'],
        message: 'is required when EMAIL_TRANSPORT=resend',
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

/** DI token for the validated environment. */
export const ENV = Symbol('ENV');

/** Validates the environment once at boot so a misconfigured deploy fails fast and says why. */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
```

Replace `apps/api/src/testing/test-env.ts` with:
```ts
import type { Env } from '../core/env.js';

/** The web origin tests send as `Origin`. The CSRF guard only accepts it. */
export const TEST_APP_ORIGIN = 'http://localhost:3000';

/** A complete, valid Env for tests; override only what a test cares about. */
export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    NODE_ENV: 'test',
    PORT: 0,
    GIT_SHA: 'test-sha',
    // Unit tests never connect; integration tests override this with the Testcontainers URL.
    DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/unused',
    APP_ORIGIN: TEST_APP_ORIGIN,
    EMAIL_TRANSPORT: 'log',
    EMAIL_FROM: 'Wishlist <wishlist@localhost>',
    MAILPIT_URL: 'http://localhost:8025',
    ...overrides,
  };
}
```

Replace `apps/api/.env.example` with:
```
# Copy to .env for local development (`cp .env.example .env`). Never commit .env.
PORT=3001
GIT_SHA=dev
DATABASE_URL=postgres://wishlist:wishlist@localhost:54329/wishlist
# The web origin. The CSRF guard only accepts state-changing requests from it.
APP_ORIGIN=http://localhost:3000
```

The E2E API server needs the new required variable. Add it to the API `webServer` entry in `e2e/playwright.config.ts`:
```bash
python3 - <<'PY'
from pathlib import Path
p = Path('e2e/playwright.config.ts')
s = p.read_text()
old = "        GIT_SHA: 'e2e',\n"
assert s.count(old) == 1
p.write_text(s.replace(old, old + "        APP_ORIGIN: `http://localhost:${WEB_PORT}`,\n"))
PY
```

**For developers:** an existing local `apps/api/.env` now needs `APP_ORIGIN=http://localhost:3000`, or `pnpm dev` stops at boot and names the variable. Task 12 documents this.

Run: `pnpm --filter @wishlist/api exec vitest run --project unit src/core/env.spec.ts`
Expected: PASS, 8 tests.

- [ ] **Step 4: Write the failing test for error headers**

In `apps/api/src/http/http-pipeline.spec.ts`, add a route and a test:
```bash
python3 - <<'PY'
from pathlib import Path
p = Path('apps/api/src/http/http-pipeline.spec.ts')
s = p.read_text()
route_anchor = "  @Get('crash')\n"
route = """  @Get('limited')
  limited(): never {
    throw new AppError(429, 'PROBE_LIMITED', 'slow down', {}, { 'Retry-After': '42' });
  }

"""
test_anchor = "  it('hides unexpected errors behind an opaque 500', async () => {\n"
test = """  it('sends the headers an AppError carries, such as Retry-After', async () => {
    const res = await http(app).get('/api/probe/limited');
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('42');
  });

"""
assert s.count(route_anchor) == 1 and s.count(test_anchor) == 1
s = s.replace(route_anchor, route + route_anchor).replace(test_anchor, test + test_anchor)
p.write_text(s)
PY
```

Run: `pnpm --filter @wishlist/api exec vitest run --project unit src/http/http-pipeline.spec.ts`
Expected: FAIL. This is a TypeScript error: `AppError` takes no fifth argument.

- [ ] **Step 5: Let AppErrors carry headers, and add the shared error factories**

Replace `apps/api/src/http/app-error.ts` with:
```ts
/**
 * Base class for expected, client-facing failures. The problem-details filter renders these as
 * RFC 9457 responses; `extras` become extension members (e.g. `remaining` on a claim conflict),
 * and `headers` are sent with the response (e.g. `Retry-After` on a 429).
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail?: string,
    readonly extras: Readonly<Record<string, unknown>> = {},
    readonly headers: Readonly<Record<string, string>> = {},
  ) {
    super(detail ?? code);
    this.name = new.target.name;
  }
}
```

Replace `apps/api/src/http/problem-details.filter.ts` with:
```ts
import { Catch, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { AppError } from './app-error.js';
import { sendProblem, toProblem } from './problem.js';
import { requestIdOf } from './request-id.js';

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemDetails');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const problem = toProblem(exception, requestIdOf(res));
    if (problem.status >= 500) {
      this.logger.error(
        `[${problem.requestId}] unhandled error`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    if (exception instanceof AppError) {
      for (const [name, value] of Object.entries(exception.headers)) res.setHeader(name, value);
    }
    sendProblem(res, problem);
  }
}
```

`apps/api/src/http/errors.ts`:
```ts
import { ErrorCode } from '@wishlist/contracts';
import { AppError } from './app-error.js';

// Shared failures. Details are generic on purpose: they never echo what the caller sent.

export const unauthenticated = (): AppError =>
  new AppError(401, ErrorCode.UNAUTHENTICATED, 'Sign in to continue.');

export const forbiddenOrigin = (): AppError =>
  new AppError(403, ErrorCode.FORBIDDEN_ORIGIN, 'Cross-site requests are not allowed.');

export const unsupportedMediaType = (): AppError =>
  new AppError(415, ErrorCode.UNSUPPORTED_MEDIA_TYPE, 'Send request bodies as application/json.');

export const rateLimited = (retryAfterSeconds: number): AppError =>
  new AppError(
    429,
    ErrorCode.RATE_LIMITED,
    'Too many attempts. Try again later.',
    {},
    { 'Retry-After': String(retryAfterSeconds) },
  );

export const validationFailed = (errors: { path: string; message: string }[]): AppError =>
  new AppError(400, ErrorCode.VALIDATION_FAILED, 'Some fields are invalid.', { errors });
```

Run: `pnpm --filter @wishlist/api exec vitest run --project unit src/http/http-pipeline.spec.ts`
Expected: PASS, including the new Retry-After test.

- [ ] **Step 6: Write the failing validation-pipe test**

`apps/api/src/http/zod-validation.pipe.spec.ts`:
```ts
import { Body, Controller, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  ErrorCode,
  ProblemSchema,
  SignupRequestSchema,
  type SignupRequest,
} from '@wishlist/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUnitApp, http } from '../testing/app.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

@Controller('probe')
class ProbeController {
  @Post('signup')
  signup(@Body(new ZodValidationPipe(SignupRequestSchema)) body: SignupRequest): SignupRequest {
    return body;
  }
}

describe('ZodValidationPipe', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createUnitApp({ controllers: [ProbeController] });
  });

  afterAll(() => app.close());

  it('hands the handler the parsed, normalized body, dropping unknown fields', async () => {
    const res = await http(app).post('/api/probe/signup').send({
      email: ' Ada@Example.com ',
      password: 'correct horse 1',
      displayName: 'Ada',
      turnstileToken: 't',
      isAdmin: true,
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      email: 'ada@example.com',
      password: 'correct horse 1',
      displayName: 'Ada',
      turnstileToken: 't',
    });
  });

  it('answers an invalid body with 400 VALIDATION_FAILED naming each bad field, not its value', async () => {
    const res = await http(app)
      .post('/api/probe/signup')
      .send({ email: 'not-an-email', password: 'short' });
    expect(res.status).toBe(400);
    const problem = ProblemSchema.parse(res.body);
    expect(problem.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(problem.errors?.map((e) => e.path).sort()).toEqual([
      'displayName',
      'email',
      'password',
      'turnstileToken',
    ]);
    expect(JSON.stringify(problem)).not.toContain('not-an-email');
  });

  it('treats a missing body as invalid', async () => {
    const res = await http(app).post('/api/probe/signup');
    expect(res.status).toBe(400);
    expect(ProblemSchema.parse(res.body).code).toBe(ErrorCode.VALIDATION_FAILED);
  });
});
```

Run: `pnpm --filter @wishlist/api exec vitest run --project unit src/http/zod-validation.pipe.spec.ts`
Expected: FAIL, because `./zod-validation.pipe.js` can't be resolved.

- [ ] **Step 7: Implement the pipe**

`apps/api/src/http/zod-validation.pipe.ts`:
```ts
import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { validationFailed } from './errors.js';

/**
 * Validates and normalizes a request body against its contracts schema (spec §5), as in
 * `@Body(new ZodValidationPipe(SignupRequestSchema))`. It's applied per parameter, because only
 * the handler knows which schema applies. Messages name the field and the rule, never the value.
 */
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw validationFailed(
      result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.') || '(body)',
        message: issue.message,
      })),
    );
  }
}
```

Run: `pnpm --filter @wishlist/api exec vitest run --project unit src/http/zod-validation.pipe.spec.ts`
Expected: PASS, 3 tests.

- [ ] **Step 8: Write the failing client-IP test**

`apps/api/src/http/client-ip.spec.ts`:
```ts
import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { clientIp } from './client-ip.js';

function request(headers: Record<string, string>, remoteAddress = '10.0.0.1'): Request {
  return { headers, socket: { remoteAddress } } as unknown as Request;
}

describe('clientIp (spec §6.6)', () => {
  it('uses x-real-ip on Vercel, whose edge overwrites anything the client sent', () => {
    expect(clientIp(request({ 'x-real-ip': '203.0.113.7' }), true)).toBe('203.0.113.7');
  });

  it('ignores x-real-ip anywhere else, because a client could set it', () => {
    expect(clientIp(request({ 'x-real-ip': '203.0.113.7' }), false)).toBe('10.0.0.1');
  });

  it('falls back to the socket address when the header is not a single IP', () => {
    expect(clientIp(request({ 'x-real-ip': '203.0.113.7, 10.0.0.9' }), true)).toBe('10.0.0.1');
  });
});
```

Run: `pnpm --filter @wishlist/api exec vitest run --project unit src/http/client-ip.spec.ts`
Expected: FAIL, because `./client-ip.js` can't be resolved.

- [ ] **Step 9: Implement it**

`apps/api/src/http/client-ip.ts`:
```ts
import { isIP } from 'node:net';
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * The caller's IP, for per-IP rate limits (spec §6.6). On Vercel the edge overwrites `x-real-ip`
 * with the real client address (spike B), so it's trusted only there. Anywhere else a client
 * could set it, so the socket address is used instead.
 */
export function clientIp(req: Request, onVercel: boolean): string {
  if (onVercel) {
    const header = req.headers['x-real-ip'];
    if (typeof header === 'string' && isIP(header)) return header;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/** `@ClientIp() ip: string` in a handler. `VERCEL` is set by the platform at runtime. */
export const ClientIp = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string =>
    clientIp(ctx.switchToHttp().getRequest<Request>(), Boolean(process.env.VERCEL)),
);
```

Run: `pnpm --filter @wishlist/api exec vitest run --project unit src/http/client-ip.spec.ts`
Expected: PASS, 3 tests.

- [ ] **Step 10: Write the failing CSRF test**

`apps/api/src/http/csrf.guard.spec.ts`:
```ts
import { Body, Controller, Delete, Get, Patch, Post, Put } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ErrorCode, ProblemSchema } from '@wishlist/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENV } from '../core/env.js';
import { createUnitApp, http } from '../testing/app.js';
import { TEST_APP_ORIGIN, testEnv } from '../testing/test-env.js';
import { CsrfGuard } from './csrf.guard.js';

@Controller('probe')
class ProbeController {
  @Get()
  read(): { ok: true } {
    return { ok: true };
  }

  @Post()
  create(@Body() body: unknown): unknown {
    return body;
  }

  @Patch()
  update(): { ok: true } {
    return { ok: true };
  }

  @Put()
  replace(): { ok: true } {
    return { ok: true };
  }

  @Delete()
  remove(): { ok: true } {
    return { ok: true };
  }
}

describe('CsrfGuard (spec §6.2)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createUnitApp({
      controllers: [ProbeController],
      providers: [
        { provide: ENV, useValue: testEnv() },
        { provide: APP_GUARD, useClass: CsrfGuard },
      ],
    });
  });

  afterAll(() => app.close());

  const codeOf = (res: { body: unknown }) => ProblemSchema.parse(res.body).code;

  it('lets safe methods through without an Origin', async () => {
    expect((await http(app).get('/api/probe')).status).toBe(200);
  });

  it('accepts a JSON request from APP_ORIGIN, with or without a charset', async () => {
    const plain = await http(app).post('/api/probe').set('Origin', TEST_APP_ORIGIN).send({ a: 1 });
    expect(plain.status).toBe(201);
    const withCharset = await http(app)
      .post('/api/probe')
      .set('Origin', TEST_APP_ORIGIN)
      .set('Content-Type', 'application/json; charset=utf-8')
      .send(JSON.stringify({ a: 1 }));
    expect(withCharset.status).toBe(201);
  });

  it('rejects a state-changing request without an Origin', async () => {
    const res = await http(app).post('/api/probe').send({ a: 1 });
    expect(res.status).toBe(403);
    expect(codeOf(res)).toBe(ErrorCode.FORBIDDEN_ORIGIN);
  });

  it('rejects other origins, including a look-alike and the opaque "null" origin', async () => {
    for (const origin of ['https://evil.example', `${TEST_APP_ORIGIN}.evil.example`, 'null']) {
      const res = await http(app).post('/api/probe').set('Origin', origin).send({ a: 1 });
      expect(res.status).toBe(403);
    }
  });

  it('rejects a non-JSON body even from APP_ORIGIN, since a form could send it without a preflight', async () => {
    const res = await http(app)
      .post('/api/probe')
      .set('Origin', TEST_APP_ORIGIN)
      .set('Content-Type', 'text/plain')
      .send('a=1');
    expect(res.status).toBe(415);
    expect(codeOf(res)).toBe(ErrorCode.UNSUPPORTED_MEDIA_TYPE);
  });

  it('guards PATCH, PUT and DELETE as well', async () => {
    for (const method of ['patch', 'put', 'delete'] as const) {
      const res = await http(app)[method]('/api/probe').send({});
      expect(res.status).toBe(403);
    }
  });
});
```

Run: `pnpm --filter @wishlist/api exec vitest run --project unit src/http/csrf.guard.spec.ts`
Expected: FAIL, because `./csrf.guard.js` can't be resolved.

- [ ] **Step 11: Implement the guard and register it globally**

`apps/api/src/http/csrf.guard.ts`:
```ts
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { ENV, type Env } from '../core/env.js';
import { forbiddenOrigin, unsupportedMediaType } from './errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF, layer 2 (spec §6.2). Layer 1 is the SameSite=Lax cookie. A state-changing request must
 * come from APP_ORIGIN, which a cross-site page can't forge, and must be JSON. A JSON content
 * type forces a CORS preflight, and we never grant one.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;
    if (req.headers.origin !== this.env.APP_ORIGIN) throw forbiddenOrigin();
    const type = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
    if (type !== 'application/json') throw unsupportedMediaType();
    return true;
  }
}
```

`apps/api/src/http/http-security.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CsrfGuard } from './csrf.guard.js';

/** Request-level protections that apply to every route. */
@Module({ providers: [{ provide: APP_GUARD, useClass: CsrfGuard }] })
export class HttpSecurityModule {}
```

Replace `apps/api/src/app.module.ts` with:
```ts
import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module.js';
import { DatabaseModule } from './db/database.module.js';
import { HealthModule } from './health/health.module.js';
import { HttpSecurityModule } from './http/http-security.module.js';

@Module({ imports: [CoreModule, DatabaseModule, HttpSecurityModule, HealthModule] })
export class AppModule {}
```

Run: `pnpm --filter @wishlist/api exec vitest run --project unit src/http/csrf.guard.spec.ts`
Expected: PASS, 6 tests.

- [ ] **Step 12: Write the failing rate-limit tests**

`apps/api/src/rate-limit/keys.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { rateLimitKey } from './keys.js';

describe('rateLimitKey', () => {
  it('scopes a hashed value, so counters never store a raw email or IP', () => {
    const key = rateLimitKey('login:email', 'ada@example.com');
    expect(key).toMatch(/^login:email:[0-9a-f]{32}$/);
    expect(key).not.toContain('ada');
  });

  it('is stable for one value, and differs between values and between scopes', () => {
    expect(rateLimitKey('login:ip', '203.0.113.7')).toBe(rateLimitKey('login:ip', '203.0.113.7'));
    expect(rateLimitKey('login:ip', '203.0.113.7')).not.toBe(rateLimitKey('login:ip', '203.0.113.8'));
    expect(rateLimitKey('login:ip', '203.0.113.7')).not.toBe(rateLimitKey('mail:ip', '203.0.113.7'));
  });
});
```

Add a test to the `describe('RateLimiter', …)` block in `apps/api/test/rate-limiter.int-spec.ts`, and import `ErrorCode`:
```bash
python3 - <<'PY'
from pathlib import Path
p = Path('apps/api/test/rate-limiter.int-spec.ts')
s = p.read_text()
imp = "import { afterAll, beforeEach, describe, expect, it } from 'vitest';\n"
anchor = "  it('admits exactly `limit` hits when requests race', async () => {\n"
test = """  it('enforce throws 429 RATE_LIMITED with Retry-After once over the limit', async () => {
    const limiter = new RateLimiter(database.db, new FakeClock(Date.UTC(2026, 9, 7, 12, 0, 30)));
    const one = { limit: 1, windowSeconds: 60 };
    await limiter.enforce('enforced', one);
    await expect(limiter.enforce('enforced', one)).rejects.toMatchObject({
      status: 429,
      code: ErrorCode.RATE_LIMITED,
      headers: { 'Retry-After': '30' },
    });
  });

"""
assert s.count(imp) == 1 and s.count(anchor) == 1
s = s.replace(imp, "import { ErrorCode } from '@wishlist/contracts';\n" + imp)
p.write_text(s.replace(anchor, test + anchor))
PY
```

Run:
```bash
pnpm --filter @wishlist/api exec vitest run --project unit src/rate-limit/keys.spec.ts
pnpm --filter @wishlist/api exec vitest run --project integration test/rate-limiter.int-spec.ts
```
Expected: both FAIL. The first because `./keys.js` can't be resolved; the second because `enforce` isn't a function, which shows up as a TypeScript error.

- [ ] **Step 13: Implement them**

`apps/api/src/rate-limit/keys.ts`:
```ts
import { createHash } from 'node:crypto';

/**
 * A rate-limit key: a scope plus a SHA-256 prefix of the identifying value (an email or an IP), so
 * the counters table never holds raw personal data.
 */
export function rateLimitKey(scope: string, value: string): string {
  return `${scope}:${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
}
```

Replace `apps/api/src/rate-limit/rate-limiter.ts` with:
```ts
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { CLOCK, type Clock } from '../core/clock.js';
import { DB, type Database } from '../db/database.module.js';
import { rateLimits } from '../db/schema.js';
import { rateLimited } from '../http/errors.js';
import { fixedWindow, type RateLimitRule } from './window.js';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

@Injectable()
export class RateLimiter {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Counts one hit against `key` in the current window. The upsert row-locks the counter, so
   * concurrent hits on the same key are serialized and can never all slip under the limit.
   */
  async consume(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const { start, retryAfterSeconds } = fixedWindow(
      this.clock.now().getTime(),
      rule.windowSeconds,
    );
    const [row] = await this.db
      .insert(rateLimits)
      .values({ key, windowStart: start, count: 1 })
      .onConflictDoUpdate({
        target: [rateLimits.key, rateLimits.windowStart],
        set: { count: sql`${rateLimits.count} + 1` },
      })
      .returning({ count: rateLimits.count });
    if (!row) throw new Error('rate limit upsert returned no row');
    return {
      allowed: row.count <= rule.limit,
      remaining: Math.max(0, rule.limit - row.count),
      retryAfterSeconds,
    };
  }

  /** Counts a hit and throws 429 with Retry-After once `key` is over its limit (spec §6.6). */
  async enforce(key: string, rule: RateLimitRule): Promise<void> {
    const result = await this.consume(key, rule);
    if (!result.allowed) throw rateLimited(result.retryAfterSeconds);
  }
}
```

Run the two commands from Step 12 again.
Expected: PASS. The integration file now has 4 tests.

- [ ] **Step 14: Gate, commit and submit**

```bash
API_ORIGIN=http://localhost:3001 pnpm turbo run lint typecheck test build
pnpm turbo run test:integration --filter=@wishlist/api
pnpm test:e2e
pnpm format:check
git add apps/api e2e/playwright.config.ts
git commit -F - <<'EOF'
feat(api): validate bodies, guard against CSRF, and enforce rate limits

A Zod pipe turns bad bodies into 400 VALIDATION_FAILED with per-field
errors. A global guard rejects state-changing requests that aren't JSON
from APP_ORIGIN (spec §6.2), which is now required at boot. RateLimiter
gains enforce(), which answers 429 with Retry-After, and keys hash the
email or IP they count.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
gh stack submit --open
```

Expected: the gate, the integration tests and E2E all pass. E2E checks that the API still boots with `APP_ORIGIN`. The PR's checks and preview pass; the preview API already receives `APP_ORIGIN`.

---

### Task 4: Security adapters (tokens, IDs, argon2id, Turnstile, HIBP)

**Files:**
- Modify: `apps/api/package.json` (adds `@node-rs/argon2` and `uuid`), `pnpm-lock.yaml`
- Create: `apps/api/src/core/ids.ts`, and in `apps/api/src/security/`: `tokens.ts`, `passwords.ts`, `captcha.ts`, `breached-passwords.ts`, `password-policy.ts`, `security.module.ts`
- Create: `apps/api/src/testing/fakes.ts`
- Test: `apps/api/src/core/ids.spec.ts`, and `tokens.spec.ts`, `passwords.spec.ts`, `captcha.spec.ts`, `breached-passwords.spec.ts`, `password-policy.spec.ts` in `apps/api/src/security/`

**Interfaces:**
- **Consumes:** `AppError` (Task 3), `ENV`/`Env` (Task 3), and `ErrorCode.PASSWORD_BREACHED` (Task 1).
- **Produces, IDs and tokens:**
  - `newId(): string`, a UUIDv7.
  - `newToken(bytes: 16 | 32): string`, base64url: 22 characters for 16 bytes, 43 for 32.
  - `hashToken(token: string): string`, SHA-256 hex.
- **Produces, passwords:**
  - `ARGON2_PARAMS`.
  - `hashPassword(password): Promise<string>`.
  - `verifyPassword(passwordHash, password): Promise<boolean>`, which never throws.
  - `burnPasswordCheck(password): Promise<void>`.
- **Produces, ports and adapters:**
  - The `CaptchaVerifier` port, `{ verify(token, remoteIp): Promise<CaptchaVerdict> }`, where `CaptchaVerdict = 'passed' | 'failed' | 'unavailable'`. Its token is `CAPTCHA_VERIFIER`, and its adapter is `TurnstileVerifier(secret, fetchFn?)`.
  - The `BreachedPasswordChecker` port, `{ isBreached(password): Promise<boolean> }`. Its token is `BREACHED_PASSWORD_CHECKER`, and its adapter is `PwnedPasswordsChecker(fetchFn?)`.
- **Produces, policy:** `PasswordPolicy.assertNotBreached(password): Promise<void>`, which throws `400 PASSWORD_BREACHED`. `passwordBreached()` builds that error.
- **Produces, wiring:** `SecurityModule` provides and exports `CAPTCHA_VERIFIER`, `BREACHED_PASSWORD_CHECKER` and `PasswordPolicy`.
- **Produces, test fakes:**
  - `FakeCaptcha`, with `verdict` and `tokens: string[]`.
  - `FakeBreachedPasswords`, with `breached: Set<string>` and `checked: string[]`.

- [ ] **Step 1: Add the stack layer and dependencies**

```bash
gh stack add api/security-adapters
pnpm --filter @wishlist/api add --save-exact @node-rs/argon2@2.2.2 uuid@14.0.2
```

Expected: both appear in `apps/api/package.json` under `dependencies` with exact versions. pnpm installs only the native package for this platform, `@node-rs/argon2-linux-x64-gnu`. These packages have no install scripts, so `allowBuilds` doesn't need changing.

- [ ] **Step 2: Write the failing ID and token tests**

`apps/api/src/core/ids.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { newId } from './ids.js';

describe('newId', () => {
  it('returns a UUIDv7, which is time-ordered and so index-friendly (spec §3)', () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('sorts IDs in the order they were created', () => {
    const ids = Array.from({ length: 50 }, () => newId());
    expect([...ids].sort()).toEqual(ids);
  });
});
```

`apps/api/src/security/tokens.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { hashToken, newToken } from './tokens.js';

describe('newToken', () => {
  it('encodes 32 random bytes as 43 base64url characters, and 16 as 22', () => {
    expect(newToken(32)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken(16)).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('never repeats', () => {
    expect(new Set(Array.from({ length: 100 }, () => newToken(32))).size).toBe(100);
  });
});

describe('hashToken', () => {
  it('stores a token as its SHA-256 in hex (spec §4)', () => {
    const token = newToken(32);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
  });
});
```

Run: `pnpm --filter @wishlist/api exec vitest run --project unit src/core/ids.spec.ts src/security/tokens.spec.ts`
Expected: FAIL, because neither module exists yet.

- [ ] **Step 3: Implement them**

`apps/api/src/core/ids.ts`:
```ts
import { v7 } from 'uuid';

/** UUIDv7: time-ordered, so index-friendly, and not enumerable (spec §3). */
export function newId(): string {
  return v7();
}
```

`apps/api/src/security/tokens.ts`:
```ts
import { createHash, randomBytes } from 'node:crypto';

/** A random base64url token: 32 bytes (sessions, email links) or 16 (share and claim links). */
export function newToken(bytes: 16 | 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * How every high-entropy token is stored: SHA-256, hex (spec §4). That's enough for random
 * tokens. Argon2 is only needed for passwords people choose.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
```

Run the command from Step 2 again.
Expected: PASS, 5 tests.

- [ ] **Step 4: Write the failing password tests**

`apps/api/src/security/passwords.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { burnPasswordCheck, hashPassword, verifyPassword } from './passwords.js';

describe('passwords (spec §6.4)', () => {
  it('hashes with argon2id at m=19 MiB, t=2, p=1', async () => {
    expect(await hashPassword('correct horse 1')).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it('verifies the right password and only the right password', async () => {
    const hash = await hashPassword('correct horse 1');
    expect(await verifyPassword(hash, 'correct horse 1')).toBe(true);
    expect(await verifyPassword(hash, 'correct horse 2')).toBe(false);
  });

  it('salts each hash', async () => {
    expect(await hashPassword('same password')).not.toBe(await hashPassword('same password'));
  });

  it('treats a malformed stored hash as a failed check instead of throwing', async () => {
    expect(await verifyPassword('not-a-phc-string', 'anything')).toBe(false);
  });

  it('can burn the time of a check without a real hash', async () => {
    await expect(burnPasswordCheck('anything')).resolves.toBeUndefined();
  });
});
```

Run: `pnpm --filter @wishlist/api exec vitest run --project unit src/security/passwords.spec.ts`
Expected: FAIL, because `./passwords.js` can't be resolved.

- [ ] **Step 5: Implement it**

`apps/api/src/security/passwords.ts`:
```ts
import { hash, verify } from '@node-rs/argon2';

/**
 * OWASP's argon2id parameters, as the spec fixes them (§6.4): m=19 MiB, t=2, p=1. Argon2id is the
 * library's default algorithm, and the tests pin it. Its `Algorithm` enum is a `const enum`,
 * which `verbatimModuleSyntax` can't import.
 */
export const ARGON2_PARAMS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_PARAMS);
}

/** False for a wrong password and for a malformed stored hash; never throws. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Does the work of a password check against a throwaway hash, so a login for an unknown email
 * takes as long as one with a wrong password (spec §6.4).
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('timing-equalizer, never a real password');
  await verifyPassword(await dummyHash, password);
}
```

Run the command from Step 4 again.
Expected: PASS, 5 tests. Each hash takes tens of milliseconds, so the file takes a moment.

- [ ] **Step 6: Write the failing Turnstile and HIBP tests**

`apps/api/src/security/captcha.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { TurnstileVerifier } from './captcha.js';

function fakeFetch(respond: () => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(respond());
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('TurnstileVerifier', () => {
  it('passes when Cloudflare accepts the token', async () => {
    const { fn } = fakeFetch(() => json({ success: true }));
    expect(await new TurnstileVerifier('secret', fn).verify('token', '203.0.113.7')).toBe('passed');
  });

  it('sends the secret, the token and the client IP to siteverify', async () => {
    const { fn, calls } = fakeFetch(() => json({ success: true }));
    await new TurnstileVerifier('secret', fn).verify('token', '203.0.113.7');
    expect(calls[0]?.url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      secret: 'secret',
      response: 'token',
      remoteip: '203.0.113.7',
    });
  });

  it('leaves out an IP it could not determine', async () => {
    const { fn, calls } = fakeFetch(() => json({ success: true }));
    await new TurnstileVerifier('secret', fn).verify('token', 'unknown');
    expect(JSON.parse(String(calls[0]?.init.body))).not.toHaveProperty('remoteip');
  });

  it('fails when Cloudflare rejects the token', async () => {
    const { fn } = fakeFetch(() =>
      json({ success: false, 'error-codes': ['invalid-input-response'] }),
    );
    expect(await new TurnstileVerifier('secret', fn).verify('token', '203.0.113.7')).toBe('failed');
  });

  it('is unavailable without a secret, and then never calls Cloudflare', async () => {
    const { fn, calls } = fakeFetch(() => json({ success: true }));
    expect(await new TurnstileVerifier(undefined, fn).verify('token', '203.0.113.7')).toBe(
      'unavailable',
    );
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['an HTTP error', () => json({}, 500)],
    ['an internal error', () => json({ success: false, 'error-codes': ['internal-error'] })],
    ['a body that is not siteverify JSON', () => new Response('<html>', { status: 200 })],
  ])('is unavailable on %s', async (_label, respond) => {
    const { fn } = fakeFetch(respond);
    expect(await new TurnstileVerifier('secret', fn).verify('token', '203.0.113.7')).toBe(
      'unavailable',
    );
  });

  it('is unavailable when Cloudflare is unreachable', async () => {
    const fn = (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch;
    expect(await new TurnstileVerifier('secret', fn).verify('token', '203.0.113.7')).toBe(
      'unavailable',
    );
  });
});
```

`apps/api/src/security/breached-passwords.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { PwnedPasswordsChecker } from './breached-passwords.js';

// SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
const PREFIX = '5BAA6';
const SUFFIX = '1E4C9B93F3F0682250B6CF8331B7EE68FD8';

function fakeFetch(respond: () => Response | Promise<Response>) {
  const urls: string[] = [];
  const fn = ((url: string) => {
    urls.push(url);
    return Promise.resolve(respond());
  }) as unknown as typeof fetch;
  return { fn, urls };
}

const range = (lines: string[]) => new Response(lines.join('\r\n'), { status: 200 });

describe('PwnedPasswordsChecker (spec §6.4)', () => {
  it('reports a password whose hash suffix is in the range with a count', async () => {
    const { fn } = fakeFetch(() => range(['0018A45C4D1DEF81644B54AB7F969B88D65:1', `${SUFFIX}:9545824`]));
    expect(await new PwnedPasswordsChecker(fn).isBreached('password')).toBe(true);
  });

  it('sends only the five-character prefix (k-anonymity)', async () => {
    const { fn, urls } = fakeFetch(() => range([]));
    await new PwnedPasswordsChecker(fn).isBreached('password');
    expect(urls).toEqual([`https://api.pwnedpasswords.com/range/${PREFIX}`]);
  });

  it('ignores padding entries, which have a count of 0', async () => {
    const { fn } = fakeFetch(() => range([`${SUFFIX}:0`]));
    expect(await new PwnedPasswordsChecker(fn).isBreached('password')).toBe(false);
  });

  it('accepts a password whose suffix is absent', async () => {
    const { fn } = fakeFetch(() => range(['0018A45C4D1DEF81644B54AB7F969B88D65:1']));
    expect(await new PwnedPasswordsChecker(fn).isBreached('password')).toBe(false);
  });

  it('skips the check when HIBP fails or is unreachable (spec §9)', async () => {
    const down = fakeFetch(() => new Response('', { status: 503 }));
    expect(await new PwnedPasswordsChecker(down.fn).isBreached('password')).toBe(false);
    const unreachable = (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch;
    expect(await new PwnedPasswordsChecker(unreachable).isBreached('password')).toBe(false);
  });
});
```

Run: `pnpm --filter @wishlist/api exec vitest run --project unit src/security/captcha.spec.ts src/security/breached-passwords.spec.ts`
Expected: FAIL, because neither module exists yet.

- [ ] **Step 7: Implement the two adapters**

`apps/api/src/security/captcha.ts`:
```ts
import { isIP } from 'node:net';
import { z } from 'zod';

export type CaptchaVerdict = 'passed' | 'failed' | 'unavailable';

/** Port for the human check on endpoints that send email (spec §6.5, §8). */
export interface CaptchaVerifier {
  verify(token: string, remoteIp: string): Promise<CaptchaVerdict>;
}

export const CAPTCHA_VERIFIER = Symbol('CAPTCHA_VERIFIER');

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const SiteverifySchema = z.object({
  success: z.boolean(),
  'error-codes': z.array(z.string()).default([]),
});

/**
 * Cloudflare Turnstile. Having no secret, a network failure, or an error on Cloudflare's side all
 * mean "unavailable". The endpoints then refuse rather than let requests through unchecked
 * (spec §9).
 */
export class TurnstileVerifier implements CaptchaVerifier {
  constructor(
    private readonly secret: string | undefined,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async verify(token: string, remoteIp: string): Promise<CaptchaVerdict> {
    if (!this.secret) return 'unavailable';
    let res: Response;
    try {
      res = await this.fetchFn(SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          secret: this.secret,
          response: token,
          ...(isIP(remoteIp) ? { remoteip: remoteIp } : {}),
        }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      return 'unavailable';
    }
    if (!res.ok) return 'unavailable';
    const json: unknown = await res.json().catch(() => undefined);
    const body = SiteverifySchema.safeParse(json);
    if (!body.success) return 'unavailable';
    if (body.data.success) return 'passed';
    return body.data['error-codes'].includes('internal-error') ? 'unavailable' : 'failed';
  }
}
```

`apps/api/src/security/breached-passwords.ts`:
```ts
import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';

/** Port for the breached-password check (spec §6.4, §8). */
export interface BreachedPasswordChecker {
  /** True only when the password is known to be breached. Any failure answers false (spec §9). */
  isBreached(password: string): Promise<boolean>;
}

export const BREACHED_PASSWORD_CHECKER = Symbol('BREACHED_PASSWORD_CHECKER');

/**
 * Have I Been Pwned's range API. Only the first five hex characters of the password's SHA-1
 * leave the server (k-anonymity), and padding hides how many suffixes share that prefix.
 */
export class PwnedPasswordsChecker implements BreachedPasswordChecker {
  private readonly logger = new Logger('PwnedPasswords');

  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async isBreached(password: string): Promise<boolean> {
    const digest = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
    const prefix = digest.slice(0, 5);
    const suffix = digest.slice(5);
    try {
      const res = await this.fetchFn(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: { 'Add-Padding': 'true', 'User-Agent': 'wishlist-app' },
        signal: AbortSignal.timeout(3_000),
      });
      if (!res.ok) throw new Error(`HIBP answered ${res.status}`);
      for (const line of (await res.text()).split('\n')) {
        const [candidate, count] = line.trim().split(':');
        if (candidate === suffix) return Number(count) > 0;
      }
      return false;
    } catch (error) {
      this.logger.warn(
        `breach check skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}
```

Run the command from Step 6 again.
Expected: PASS, 14 tests: 9 for Turnstile and 5 for HIBP.

- [ ] **Step 8: Write the failing password-policy test, with the fakes it needs**

`apps/api/src/testing/fakes.ts`:
```ts
import type { BreachedPasswordChecker } from '../security/breached-passwords.js';
import type { CaptchaVerdict, CaptchaVerifier } from '../security/captcha.js';

/** Turnstile stand-in. Set `verdict`; `tokens` records what was checked. */
export class FakeCaptcha implements CaptchaVerifier {
  verdict: CaptchaVerdict = 'passed';
  readonly tokens: string[] = [];

  verify(token: string): Promise<CaptchaVerdict> {
    this.tokens.push(token);
    return Promise.resolve(this.verdict);
  }
}

/** HIBP stand-in. Add passwords to `breached`; `checked` records every password looked up. */
export class FakeBreachedPasswords implements BreachedPasswordChecker {
  readonly breached = new Set<string>();
  readonly checked: string[] = [];

  isBreached(password: string): Promise<boolean> {
    this.checked.push(password);
    return Promise.resolve(this.breached.has(password));
  }
}
```

`apps/api/src/security/password-policy.spec.ts`:
```ts
import { ErrorCode } from '@wishlist/contracts';
import { describe, expect, it } from 'vitest';
import { FakeBreachedPasswords } from '../testing/fakes.js';
import { PasswordPolicy } from './password-policy.js';

describe('PasswordPolicy', () => {
  it('refuses a breached password with 400 PASSWORD_BREACHED, without echoing it', async () => {
    const breaches = new FakeBreachedPasswords();
    breaches.breached.add('hunter2hunter2');
    const error: unknown = await new PasswordPolicy(breaches)
      .assertNotBreached('hunter2hunter2')
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 400, code: ErrorCode.PASSWORD_BREACHED });
    expect(JSON.stringify(error)).not.toContain('hunter2');
  });

  it('accepts a password HIBP does not know', async () => {
    await expect(
      new PasswordPolicy(new FakeBreachedPasswords()).assertNotBreached('a fine password'),
    ).resolves.toBeUndefined();
  });
});
```

Run: `pnpm --filter @wishlist/api exec vitest run --project unit src/security/password-policy.spec.ts`
Expected: FAIL, because `./password-policy.js` can't be resolved.

- [ ] **Step 9: Implement the policy and the module**

`apps/api/src/security/password-policy.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode } from '@wishlist/contracts';
import { AppError } from '../http/app-error.js';
import { BREACHED_PASSWORD_CHECKER, type BreachedPasswordChecker } from './breached-passwords.js';

export const passwordBreached = (): AppError =>
  new AppError(
    400,
    ErrorCode.PASSWORD_BREACHED,
    'This password has appeared in a data breach. Choose a different one.',
  );

/** Spec §6.4: checked on signup, reset and change. The contract schemas enforce length. */
@Injectable()
export class PasswordPolicy {
  constructor(
    @Inject(BREACHED_PASSWORD_CHECKER) private readonly breaches: BreachedPasswordChecker,
  ) {}

  async assertNotBreached(password: string): Promise<void> {
    if (await this.breaches.isBreached(password)) throw passwordBreached();
  }
}
```

`apps/api/src/security/security.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { ENV, type Env } from '../core/env.js';
import { BREACHED_PASSWORD_CHECKER, PwnedPasswordsChecker } from './breached-passwords.js';
import { CAPTCHA_VERIFIER, TurnstileVerifier } from './captcha.js';
import { PasswordPolicy } from './password-policy.js';

/** The CAPTCHA and breached-password ports (spec §8) with their real adapters. */
@Module({
  providers: [
    {
      provide: CAPTCHA_VERIFIER,
      inject: [ENV],
      useFactory: (env: Env) => new TurnstileVerifier(env.TURNSTILE_SECRET_KEY),
    },
    { provide: BREACHED_PASSWORD_CHECKER, useFactory: () => new PwnedPasswordsChecker() },
    PasswordPolicy,
  ],
  exports: [CAPTCHA_VERIFIER, BREACHED_PASSWORD_CHECKER, PasswordPolicy],
})
export class SecurityModule {}
```

Run the command from Step 8 again.
Expected: PASS, 2 tests.

`SecurityModule` doesn't join the app until Task 6's `AuthModule` imports it.

- [ ] **Step 10: Gate, commit and submit**

```bash
API_ORIGIN=http://localhost:3001 pnpm turbo run lint typecheck test build
pnpm format:check
git add apps/api pnpm-lock.yaml
git commit -F - <<'EOF'
feat(api): add token, password, Turnstile and breached-password adapters

argon2id at the spec's parameters, with a dummy check that keeps unknown
emails as slow as wrong passwords. Turnstile and HIBP sit behind ports.
Turnstile fails closed ("unavailable"); HIBP fails open (spec §9).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
gh stack submit --open
```

Expected: the gate passes. The PR's checks pass, including `dependency-review` for the two new packages.

---

### Task 5: Email: the port, three adapters, and background delivery (then ⏸ merge stack 1)

**Files:**
- Create in `apps/api/src/email/`: `email-sender.ts`, `log-email-sender.ts`, `mailpit-email-sender.ts`, `resend-email-sender.ts`, `mailer.ts`, `email.module.ts`
- Modify: `apps/api/src/testing/fakes.ts` (adds `FakeEmailSender`), `docker-compose.yml`, `apps/api/.env.example`
- Test in `apps/api/src/email/`: `email-sender.spec.ts`, `resend-email-sender.spec.ts`, `mailpit-email-sender.spec.ts`, `mailer.spec.ts`, `email.module.spec.ts`
- Test: `apps/api/test/mailpit-email-sender.int-spec.ts`, against a real Mailpit in Testcontainers

**Interfaces:**
- **Consumes:** `Env.EMAIL_TRANSPORT`, `EMAIL_FROM`, `RESEND_API_KEY` and `MAILPIT_URL` (Task 3).
- **Produces, the port:**
  - `interface EmailMessage { to; subject; text; html }`.
  - `interface EmailSender { send(message): Promise<void> }` and its token `EMAIL_SENDER`. `send` rejects when delivery fails.
  - `parseAddress('Name <a@b>') → { name, email }`.
- **Produces, adapters:** `LogEmailSender`, `MailpitEmailSender(baseUrl, from, fetchFn?)` and `ResendEmailSender(apiKey, from, fetchFn?)`. `emailSenderFor(env)` picks one.
- **Produces, delivery:**
  - `Mailer.queue(message): void`. It calls `send` synchronously, then lets delivery finish in the background.
  - `EmailModule`, which provides `EMAIL_SENDER` and `Mailer` and exports `Mailer`.
- **Produces, test fake:** `FakeEmailSender`, with `sent: EmailMessage[]` and `failNext: boolean`. It records each message before it settles.

- [ ] **Step 1: Add the stack layer**

```bash
gh stack add api/email
```

- [ ] **Step 2: Write the failing adapter tests**

`apps/api/src/email/email-sender.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseAddress } from './email-sender.js';

describe('parseAddress', () => {
  it('splits the EMAIL_FROM format into name and address', () => {
    expect(parseAddress('Wishlist <no-reply@mail.example.com>')).toEqual({
      name: 'Wishlist',
      email: 'no-reply@mail.example.com',
    });
  });

  it('rejects a bare address', () => {
    expect(() => parseAddress('no-reply@example.com')).toThrow(/Name <address@domain>/);
  });
});
```

`apps/api/src/email/resend-email-sender.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ResendEmailSender } from './resend-email-sender.js';

const message = { to: 'ada@example.com', subject: 'Hi', text: 'Hello', html: '<p>Hello</p>' };

function fakeFetch(status: number) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response('{"id":"x"}', { status }));
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('ResendEmailSender', () => {
  it('posts the message to Resend with the API key as a bearer token', async () => {
    const { fn, calls } = fakeFetch(200);
    await new ResendEmailSender('re_key', 'Wishlist <no-reply@mail.example.com>', fn).send(message);
    expect(calls[0]?.url).toBe('https://api.resend.com/emails');
    expect(new Headers(calls[0]?.init.headers).get('authorization')).toBe('Bearer re_key');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      from: 'Wishlist <no-reply@mail.example.com>',
      to: ['ada@example.com'],
      subject: 'Hi',
      text: 'Hello',
      html: '<p>Hello</p>',
    });
  });

  it('rejects when Resend refuses, without putting the key in the error', async () => {
    const { fn } = fakeFetch(422);
    const error: unknown = await new ResendEmailSender('re_key', 'W <w@x.io>', fn)
      .send(message)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain('422');
    expect(String(error)).not.toContain('re_key');
  });
});
```

`apps/api/src/email/mailpit-email-sender.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { MailpitEmailSender } from './mailpit-email-sender.js';

describe('MailpitEmailSender', () => {
  it("speaks Mailpit's send API, with its capitalized field names", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fn = ((url: URL, init: RequestInit) => {
      calls.push({ url: url.toString(), init });
      return Promise.resolve(new Response('{"ID":"1"}', { status: 200 }));
    }) as unknown as typeof fetch;
    await new MailpitEmailSender('http://localhost:8025', 'Wishlist <wishlist@localhost>', fn).send({
      to: 'ada@example.com',
      subject: 'Hi',
      text: 'Hello',
      html: '<p>Hello</p>',
    });
    expect(calls[0]?.url).toBe('http://localhost:8025/api/v1/send');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      From: { Email: 'wishlist@localhost', Name: 'Wishlist' },
      To: [{ Email: 'ada@example.com' }],
      Subject: 'Hi',
      Text: 'Hello',
      HTML: '<p>Hello</p>',
    });
  });
});
```

Run: `pnpm --filter @wishlist/api exec vitest run --project unit src/email`
Expected: FAIL, because the email modules don't exist yet.

- [ ] **Step 3: Implement the port and the adapters**

`apps/api/src/email/email-sender.ts`:
```ts
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Port for outgoing email (spec §8). `send` rejects when delivery fails. */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export const EMAIL_SENDER = Symbol('EMAIL_SENDER');

/** Splits the EMAIL_FROM format, `Name <address>`, for APIs that want the parts separately. */
export function parseAddress(value: string): { name: string; email: string } {
  const match = /^(.+?)\s*<([^<>\s]+)>$/.exec(value);
  if (!match?.[1] || !match[2]) throw new Error('expected "Name <address@domain>"');
  return { name: match[1], email: match[2] };
}
```

`apps/api/src/email/log-email-sender.ts`:
```ts
import { Logger } from '@nestjs/common';
import type { EmailMessage, EmailSender } from './email-sender.js';

/**
 * Writes emails to the log instead of sending them. Previews use it, because they must never send
 * mail (spec §10). The text, links included, is logged so a reviewer can follow a verification
 * link from the preview's logs. Vercel keeps those for an hour, and only the account owner can
 * read them (spec §6.7).
 */
export class LogEmailSender implements EmailSender {
  private readonly logger = new Logger('Email');

  send(message: EmailMessage): Promise<void> {
    this.logger.log(`to=${message.to} subject="${message.subject}"\n${message.text}`);
    return Promise.resolve();
  }
}
```

`apps/api/src/email/mailpit-email-sender.ts`:
```ts
import { parseAddress, type EmailMessage, type EmailSender } from './email-sender.js';

/** Delivers into Mailpit's inbox through its HTTP send API: local development and E2E. */
export class MailpitEmailSender implements EmailSender {
  private readonly from: { name: string; email: string };

  constructor(
    private readonly baseUrl: string,
    from: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.from = parseAddress(from);
  }

  async send(message: EmailMessage): Promise<void> {
    const res = await this.fetchFn(new URL('/api/v1/send', this.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        From: { Email: this.from.email, Name: this.from.name },
        To: [{ Email: message.to }],
        Subject: message.subject,
        Text: message.text,
        HTML: message.html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Mailpit answered ${res.status}`);
  }
}
```

`apps/api/src/email/resend-email-sender.ts`:
```ts
import type { EmailMessage, EmailSender } from './email-sender.js';

/** Resend's REST API (spec §3), through plain fetch, so there's no SDK in the dependency tree. */
export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const res = await this.fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Resend answered ${res.status}`);
  }
}
```

Run: `pnpm --filter @wishlist/api exec vitest run --project unit src/email`
Expected: PASS, 5 tests.

- [ ] **Step 4: Write the failing tests for the mailer and the transport choice, plus their fake**

Replace `apps/api/src/testing/fakes.ts` with:
```ts
import type { EmailMessage, EmailSender } from '../email/email-sender.js';
import type { BreachedPasswordChecker } from '../security/breached-passwords.js';
import type { CaptchaVerdict, CaptchaVerifier } from '../security/captcha.js';

/** Turnstile stand-in. Set `verdict`; `tokens` records what was checked. */
export class FakeCaptcha implements CaptchaVerifier {
  verdict: CaptchaVerdict = 'passed';
  readonly tokens: string[] = [];

  verify(token: string): Promise<CaptchaVerdict> {
    this.tokens.push(token);
    return Promise.resolve(this.verdict);
  }
}

/** HIBP stand-in. Add passwords to `breached`; `checked` records every password looked up. */
export class FakeBreachedPasswords implements BreachedPasswordChecker {
  readonly breached = new Set<string>();
  readonly checked: string[] = [];

  isBreached(password: string): Promise<boolean> {
    this.checked.push(password);
    return Promise.resolve(this.breached.has(password));
  }
}

/**
 * Records every message the moment `send` is called, before the promise settles. So a test sees
 * a queued email as soon as the HTTP response arrives. Set `failNext` to make the next delivery
 * fail.
 */
export class FakeEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  failNext = false;

  send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('email provider is down'));
    }
    return Promise.resolve();
  }
}
```

`apps/api/src/email/mailer.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { FakeEmailSender } from '../testing/fakes.js';
import { Mailer } from './mailer.js';

const message = { to: 'ada@example.com', subject: 'Hi', text: 'Hello', html: '<p>Hello</p>' };

describe('Mailer', () => {
  it('hands the message to the sender before returning', () => {
    const sender = new FakeEmailSender();
    new Mailer(sender).queue(message);
    expect(sender.sent).toEqual([message]);
  });

  it('swallows a failed delivery, so a provider outage never fails the request (spec §9)', async () => {
    const sender = new FakeEmailSender();
    sender.failNext = true;
    expect(() => new Mailer(sender).queue(message)).not.toThrow();
    // Give the rejection a turn to surface. Vitest fails the run on an unhandled rejection.
    await new Promise((resolve) => setImmediate(resolve));
  });
});
```

`apps/api/src/email/email.module.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { testEnv } from '../testing/test-env.js';
import { emailSenderFor } from './email.module.js';
import { LogEmailSender } from './log-email-sender.js';
import { MailpitEmailSender } from './mailpit-email-sender.js';
import { ResendEmailSender } from './resend-email-sender.js';

describe('emailSenderFor', () => {
  it('picks the adapter EMAIL_TRANSPORT names', () => {
    expect(emailSenderFor(testEnv({ EMAIL_TRANSPORT: 'log' }))).toBeInstanceOf(LogEmailSender);
    expect(emailSenderFor(testEnv({ EMAIL_TRANSPORT: 'mailpit' }))).toBeInstanceOf(
      MailpitEmailSender,
    );
    expect(
      emailSenderFor(testEnv({ EMAIL_TRANSPORT: 'resend', RESEND_API_KEY: 're_test' })),
    ).toBeInstanceOf(ResendEmailSender);
  });
});
```

Run: `pnpm --filter @wishlist/api exec vitest run --project unit src/email`
Expected: FAIL, because `./mailer.js` and `./email.module.js` can't be resolved.

- [ ] **Step 5: Implement them**

`apps/api/src/email/mailer.ts`:
```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { waitUntil } from '@vercel/functions';
import { EMAIL_SENDER, type EmailMessage, type EmailSender } from './email-sender.js';

/**
 * Sends email in the background. Responses never wait on delivery. So their timing can't reveal
 * whether an address has an account, and a provider outage never fails a request (spec §9: the
 * endpoint still returns 202, and the user can resend). On Vercel, waitUntil keeps the function
 * alive until delivery settles. Elsewhere waitUntil does nothing and the promise simply runs on.
 */
@Injectable()
export class Mailer {
  private readonly logger = new Logger('Mailer');

  constructor(@Inject(EMAIL_SENDER) private readonly sender: EmailSender) {}

  queue(message: EmailMessage): void {
    const delivery = this.sender.send(message).catch((error: unknown) => {
      // No recipient in the log line: it's personal data. Sentry arrives in Plan 5.
      this.logger.error(
        `delivery of "${message.subject}" failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    waitUntil(delivery);
  }
}
```

`apps/api/src/email/email.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { ENV, type Env } from '../core/env.js';
import { EMAIL_SENDER, type EmailSender } from './email-sender.js';
import { LogEmailSender } from './log-email-sender.js';
import { Mailer } from './mailer.js';
import { MailpitEmailSender } from './mailpit-email-sender.js';
import { ResendEmailSender } from './resend-email-sender.js';

/** The adapter EMAIL_TRANSPORT names (spec §10 Environments: Mailpit locally, log in previews). */
export function emailSenderFor(env: Env): EmailSender {
  switch (env.EMAIL_TRANSPORT) {
    case 'resend':
      if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is required for EMAIL_TRANSPORT=resend');
      return new ResendEmailSender(env.RESEND_API_KEY, env.EMAIL_FROM);
    case 'mailpit':
      return new MailpitEmailSender(env.MAILPIT_URL, env.EMAIL_FROM);
    case 'log':
      return new LogEmailSender();
  }
}

@Module({
  providers: [{ provide: EMAIL_SENDER, inject: [ENV], useFactory: emailSenderFor }, Mailer],
  exports: [Mailer],
})
export class EmailModule {}
```

Run: `pnpm --filter @wishlist/api exec vitest run --project unit src/email`
Expected: PASS, 8 tests.

- [ ] **Step 6: Prove the Mailpit adapter against a real Mailpit**

`apps/api/test/mailpit-email-sender.int-spec.ts`:
```ts
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MailpitEmailSender } from '../src/email/mailpit-email-sender.js';

// The same image docker-compose.yml runs, so local development and this test agree.
const MAILPIT_IMAGE = 'axllent/mailpit:v1.31.4';

let mailpit: StartedTestContainer;
let baseUrl: string;

beforeAll(async () => {
  mailpit = await new GenericContainer(MAILPIT_IMAGE)
    .withExposedPorts(8025)
    .withWaitStrategy(Wait.forHttp('/api/v1/info', 8025))
    .start();
  baseUrl = `http://${mailpit.getHost()}:${mailpit.getMappedPort(8025)}`;
});

afterAll(() => mailpit.stop());

describe('MailpitEmailSender against Mailpit', () => {
  it('delivers a message that shows up in the inbox', async () => {
    await new MailpitEmailSender(baseUrl, 'Wishlist <wishlist@localhost>').send({
      to: 'ada@example.com',
      subject: 'Confirm your email',
      text: 'Plain body',
      html: '<p>Plain body</p>',
    });

    const res = await fetch(`${baseUrl}/api/v1/search?query=${encodeURIComponent('to:ada@example.com')}`);
    const body = (await res.json()) as {
      messages: { Subject: string; From: { Address: string; Name: string } }[];
    };
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toMatchObject({
      Subject: 'Confirm your email',
      From: { Address: 'wishlist@localhost', Name: 'Wishlist' },
    });
  });
});
```

Run: `pnpm --filter @wishlist/api exec vitest run --project integration test/mailpit-email-sender.int-spec.ts`
Expected: PASS, 1 test. The first run pulls the image.

- [ ] **Step 7: Run Mailpit for local development**

Add a service to `docker-compose.yml`:
```bash
python3 - <<'PY'
from pathlib import Path
p = Path('docker-compose.yml')
s = p.read_text()
anchor = '\nvolumes:\n'
service = """
  # Catches every email the API sends locally (EMAIL_TRANSPORT=mailpit). Inbox: http://localhost:8025
  mailpit:
    image: axllent/mailpit:v1.31.4
    ports:
      - '8025:8025'
"""
assert s.count(anchor) == 1
p.write_text(s.replace(anchor, service + anchor))
PY
docker compose up -d --wait
curl -fsS http://localhost:8025/api/v1/info | jq -r .Version
```
Expected: `v1.31.4`. The image's own healthcheck lets `--wait` finish.

Append to `apps/api/.env.example`:
```
# Local email lands in Mailpit: http://localhost:8025 (docker compose).
EMAIL_TRANSPORT=mailpit
```

- [ ] **Step 8: Gate, commit and submit**

```bash
API_ORIGIN=http://localhost:3001 pnpm turbo run lint typecheck test build
pnpm turbo run test:integration --filter=@wishlist/api
pnpm format:check
git add apps/api docker-compose.yml
git commit -F - <<'EOF'
feat(api): add the email port with log, Mailpit and Resend adapters

Mailer.queue() delivers in the background (waitUntil on Vercel), so
responses never wait on, or reveal anything through, delivery, and a
provider outage never fails a request (spec §9). Local development gets
a Mailpit inbox in docker compose.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
gh stack submit --open
```

Expected: the gate and the integration tests pass, and so do all checks on the six `auth-api-1` PRs.

- [ ] **Step 9: ⏸ CHECKPOINT — Ted reviews and merges `auth-api-1`**

**What this changes in production:**
- **Every API mutation now needs `Origin`.** That covers non-GET requests, and there aren't any routes for them yet.
- **The API requires `APP_ORIGIN`,** which production already has.
- **The migration adds four empty tables.**

```bash
gh stack merge <top-pr> --squash --yes
gh stack sync --prune && git switch main && git pull --ff-only
RID=$(gh run list --workflow deploy.yml --commit "$(git rev-parse HEAD)" --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RID" --interval 15 --exit-status
curl -fsS "$(gh variable get APP_PRODUCTION_ORIGIN)/api/health"
SID=$(gh run list --workflow preview-seed.yml --limit 1 --json databaseId,event --jq '.[] | select(.event=="push") | .databaseId')
gh run watch "$SID" --interval 10 --exit-status
```

Expected:
- **Production deploy:** all seven jobs pass. `migrate` applies `0001_auth`.
- **Production health:** `{"status":"ok","sha":"<HEAD>","db":{"ok":true,"migrationsApplied":2}}`.
- **`preview-seed`:** it ran from the push that touched `apps/api/drizzle/**`, migrated incrementally, and skipped the wipe.

---

### Task 6: Sessions, `GET /me` and logout

**Files:**
- Create in `apps/api/src/auth/`: `session-cookie.ts`, `sessions.service.ts`, `session.guard.ts`, `me.controller.ts`, `session.controller.ts`, `auth.module.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/testing/fakes.ts` (adds `FakeClock`), `e2e/tests/smoke/smoke.spec.ts`
- Create in `apps/api/test/support/`: `auth-app.ts`, `client.ts`
- Test: `apps/api/src/auth/session-cookie.spec.ts`, `apps/api/test/sessions.int-spec.ts`

**Interfaces:**
- **Consumes:**
  - From Task 2: the `users` and `sessions` tables.
  - From Task 4: `newToken` and `hashToken`.
  - From Task 3: `unauthenticated()`, `ENV` and `TEST_APP_ORIGIN`.
  - From Tasks 3–5: `RateLimitModule`, `SecurityModule` and `EmailModule`.
  - From Task 1: `MeResponse`.
- **Produces, the cookie:**
  - `SESSION_COOKIE = '__Host-session'`, `SESSION_TTL_MS` (30 days) and `SESSION_REFRESH_MS` (1 hour).
  - `readSessionToken(cookieHeader)`, `setSessionCookie(res, token, maxAgeMs)` and `clearSessionCookie(res)`.
- **Produces, the sessions service:**
  - `SessionsService.create(userId)` returns `{ token, maxAgeMs }`.
  - `SessionsService.resolve(token)` returns `{ sessionId, user, maxAgeMs, refreshed } | null`, where `user` is a `SessionUser` `{id, email, displayName, emailVerified}`.
  - `SessionsService.revoke(token)`.
- **Produces, the guard:** `SessionGuard`, `@CurrentAuth()` and `interface AuthContext { sessionId; user: SessionUser }`.
- **Produces, routes:** `GET /me` and `POST /auth/logout`. Later tasks add to `AuthModule` (controllers and providers), `SessionController` (login) and `MeController`.
- **Produces, test harness:**
  - `FakeClock(start)`, with `now()`, `set(date)` and `advance(ms)`.
  - `createAuthTestApp(databaseUrl, env?)`, which returns `{ app, clock, emails, captcha, breaches, reset() }`. Every port is faked.
  - `client(app, cookie?)`, with `.get(path)`, `.post(path, body?)`, `.patch(...)` and `.delete(...)`.
  - `setCookies(res)`, `sessionCookie(res)` and `linkToken(text)`.

- [ ] **Step 1: Add the stack layer**

```bash
git switch main && git pull --ff-only
gh stack init api/sessions
```

- [ ] **Step 2: Write the failing cookie tests**

`apps/api/src/auth/session-cookie.spec.ts`:
```ts
import { Controller, Get, Res } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Response } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUnitApp, http } from '../testing/app.js';
import {
  clearSessionCookie,
  readSessionToken,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  setSessionCookie,
} from './session-cookie.js';

const TOKEN = 'A'.repeat(43);

describe('readSessionToken', () => {
  it('finds the session cookie among others', () => {
    expect(readSessionToken(`theme=dark; ${SESSION_COOKIE}=${TOKEN}; other=1`)).toBe(TOKEN);
  });

  it('ignores a missing header, a missing cookie, and a malformed token', () => {
    expect(readSessionToken(undefined)).toBeUndefined();
    expect(readSessionToken('theme=dark')).toBeUndefined();
    expect(readSessionToken(`${SESSION_COOKIE}=not-a-token`)).toBeUndefined();
  });
});

@Controller('probe')
class ProbeController {
  @Get('set')
  set(@Res({ passthrough: true }) res: Response): void {
    setSessionCookie(res, TOKEN, SESSION_TTL_MS);
  }

  @Get('clear')
  clear(@Res({ passthrough: true }) res: Response): void {
    clearSessionCookie(res);
  }
}

describe('session cookie attributes (spec §6.1)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createUnitApp({ controllers: [ProbeController] });
  });

  afterAll(() => app.close());

  it('sets __Host-session HttpOnly, Secure, SameSite=Lax, Path=/ for 30 days', async () => {
    const res = await http(app).get('/api/probe/set');
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=${TOKEN}; Max-Age=2592000; Path=/; `));
    expect(cookie).toMatch(/; HttpOnly; Secure; SameSite=Lax$/);
    expect(cookie).not.toMatch(/Domain=/i);
  });

  it('clears it with the same attributes, so the browser replaces rather than adds', async () => {
    const res = await http(app).get('/api/probe/clear');
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=; Path=/; Expires=Thu, 01 Jan 1970`));
    expect(cookie).toMatch(/; HttpOnly; Secure; SameSite=Lax$/);
  });
});
```

Run: `pnpm --filter @wishlist/api exec vitest run --project unit src/auth/session-cookie.spec.ts`
Expected: FAIL, because `./session-cookie.js` can't be resolved.

- [ ] **Step 3: Implement the cookie helpers**

`apps/api/src/auth/session-cookie.ts`:
```ts
import type { Response } from 'express';

/**
 * The `__Host-` prefix makes browsers insist on Secure, Path=/ and no Domain (spec §6.1). Browsers
 * treat http://localhost as secure, so the cookie works in local development and E2E too.
 */
export const SESSION_COOKIE = '__Host-session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Sliding expiry moves forward at most this often, so reads don't write on every request. */
export const SESSION_REFRESH_MS = 60 * 60 * 1000;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** The session token from a Cookie header, if it's there and well-formed. */
export function readSessionToken(cookieHeader: string | undefined): string | undefined {
  for (const pair of cookieHeader?.split(';') ?? []) {
    const [name, value] = pair.trim().split('=', 2);
    if (name === SESSION_COOKIE) {
      return value !== undefined && TOKEN_PATTERN.test(value) ? value : undefined;
    }
  }
  return undefined;
}

const ATTRIBUTES = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const;

export function setSessionCookie(res: Response, token: string, maxAgeMs: number): void {
  res.cookie(SESSION_COOKIE, token, { ...ATTRIBUTES, maxAge: maxAgeMs });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, ATTRIBUTES);
}
```

Run the command from Step 2 again.
Expected: PASS, 4 tests.

- [ ] **Step 4: Build the integration harness**

Replace `apps/api/src/testing/fakes.ts` with the following. It's the Task 5 file plus `FakeClock`:
```ts
import type { Clock } from '../core/clock.js';
import type { EmailMessage, EmailSender } from '../email/email-sender.js';
import type { BreachedPasswordChecker } from '../security/breached-passwords.js';
import type { CaptchaVerdict, CaptchaVerifier } from '../security/captcha.js';

/** A clock tests move by hand. */
export class FakeClock implements Clock {
  private current: Date;

  constructor(start: Date) {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(time: Date): void {
    this.current = new Date(time);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** Turnstile stand-in. Set `verdict`; `tokens` records what was checked. */
export class FakeCaptcha implements CaptchaVerifier {
  verdict: CaptchaVerdict = 'passed';
  readonly tokens: string[] = [];

  verify(token: string): Promise<CaptchaVerdict> {
    this.tokens.push(token);
    return Promise.resolve(this.verdict);
  }
}

/** HIBP stand-in. Add passwords to `breached`; `checked` records every password looked up. */
export class FakeBreachedPasswords implements BreachedPasswordChecker {
  readonly breached = new Set<string>();
  readonly checked: string[] = [];

  isBreached(password: string): Promise<boolean> {
    this.checked.push(password);
    return Promise.resolve(this.breached.has(password));
  }
}

/**
 * Records every message the moment `send` is called, before the promise settles. So a test sees
 * a queued email as soon as the HTTP response arrives. Set `failNext` to make the next delivery
 * fail.
 */
export class FakeEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  failNext = false;

  send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('email provider is down'));
    }
    return Promise.resolve();
  }
}
```

`apps/api/test/support/auth-app.ts`:
```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { CLOCK } from '../../src/core/clock.js';
import type { Env } from '../../src/core/env.js';
import { EMAIL_SENDER } from '../../src/email/email-sender.js';
import { BREACHED_PASSWORD_CHECKER } from '../../src/security/breached-passwords.js';
import { CAPTCHA_VERIFIER } from '../../src/security/captcha.js';
import {
  FakeBreachedPasswords,
  FakeCaptcha,
  FakeClock,
  FakeEmailSender,
} from '../../src/testing/fakes.js';
import { createTestApp } from './app.js';

export const TEST_START = new Date('2026-10-01T12:00:00.000Z');

export interface AuthTestApp {
  app: NestExpressApplication;
  clock: FakeClock;
  emails: FakeEmailSender;
  captcha: FakeCaptcha;
  breaches: FakeBreachedPasswords;
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
        .useValue(breaches),
  });
  return {
    app,
    clock,
    emails,
    captcha,
    breaches,
    reset() {
      clock.set(TEST_START);
      emails.sent.length = 0;
      emails.failNext = false;
      captcha.verdict = 'passed';
      captcha.tokens.length = 0;
      breaches.breached.clear();
      breaches.checked.length = 0;
    },
  };
}
```

`apps/api/test/support/client.ts`:
```ts
import type { INestApplication } from '@nestjs/common';
import { SESSION_COOKIE } from '../../src/auth/session-cookie.js';
import { http } from '../../src/testing/app.js';
import { TEST_APP_ORIGIN } from '../../src/testing/test-env.js';

type PendingRequest = ReturnType<ReturnType<typeof http>['get']>;
export type ApiResponse = Awaited<PendingRequest>;

/**
 * Calls the API the way the web app's browser does: under /api, with JSON bodies, and with
 * `Origin: APP_ORIGIN` on anything that changes state, which is all the CSRF guard accepts. Pass
 * a cookie from `sessionCookie` to act as a signed-in user.
 */
export function client(app: INestApplication, cookie?: string) {
  const signedIn = (req: PendingRequest): PendingRequest => (cookie ? req.set('Cookie', cookie) : req);
  const mutate = (req: PendingRequest, body: object): PendingRequest =>
    signedIn(req.set('Origin', TEST_APP_ORIGIN)).send(body);
  return {
    get: (path: string) => signedIn(http(app).get(`/api${path}`)),
    post: (path: string, body: object = {}) => mutate(http(app).post(`/api${path}`), body),
    patch: (path: string, body: object = {}) => mutate(http(app).patch(`/api${path}`), body),
    delete: (path: string, body: object = {}) => mutate(http(app).delete(`/api${path}`), body),
  };
}

/** Every Set-Cookie header on a response. */
export function setCookies(res: ApiResponse): string[] {
  const header: unknown = res.headers['set-cookie'];
  if (Array.isArray(header)) return header.map(String);
  return typeof header === 'string' ? [header] : [];
}

/** The `__Host-session=<token>` pair a response set, ready to send back as a Cookie header. */
export function sessionCookie(res: ApiResponse): string {
  const pair = setCookies(res)
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.split(';')[0];
  if (!pair) throw new Error('the response did not set a session cookie');
  return pair;
}

/** The token from an emailed link (`…?token=<43 characters>`). */
export function linkToken(text: string): string {
  const token = /[?&]token=([A-Za-z0-9_-]{43})/.exec(text)?.[1];
  if (!token) throw new Error('no link with a token in this email');
  return token;
}
```

- [ ] **Step 5: Write the failing session tests**

`apps/api/test/sessions.int-spec.ts`:
```ts
import { ErrorCode, MeResponseSchema, ProblemSchema } from '@wishlist/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../src/auth/session-cookie.js';
import { SessionsService } from '../src/auth/sessions.service.js';
import { newId } from '../src/core/ids.js';
import { http } from '../src/testing/app.js';
import { createAuthTestApp, type AuthTestApp } from './support/auth-app.js';
import { client, sessionCookie, setCookies } from './support/client.js';
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

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** A user with a session, made directly: signup and login arrive in later tasks. */
async function signedIn(): Promise<{ userId: string; cookie: string }> {
  const userId = newId();
  await db.pool.query(
    `insert into users (id, email, password_hash, display_name) values ($1, 'ada@example.com', 'x', 'Ada')`,
    [userId],
  );
  const { token } = await t.app.get(SessionsService).create(userId);
  return { userId, cookie: `${SESSION_COOKIE}=${token}` };
}

describe('sessions (spec §6.1)', () => {
  it('GET /me returns the signed-in user', async () => {
    const { userId, cookie } = await signedIn();
    const res = await client(t.app, cookie).get('/me');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(MeResponseSchema.parse(res.body)).toEqual({
      id: userId,
      email: 'ada@example.com',
      displayName: 'Ada',
      emailVerified: false,
    });
  });

  it('answers 401 UNAUTHENTICATED without a session, or with a token that matches none', async () => {
    for (const cookie of [undefined, `${SESSION_COOKIE}=${'A'.repeat(43)}`]) {
      const res = await client(t.app, cookie).get('/me');
      expect(res.status).toBe(401);
      expect(ProblemSchema.parse(res.body).code).toBe(ErrorCode.UNAUTHENTICATED);
    }
  });

  it('stores only a hash of the token', async () => {
    const { cookie } = await signedIn();
    const token = cookie.split('=')[1];
    const { rows } = await db.pool.query<{ id: string }>('select id from sessions');
    expect(rows[0]?.id).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]?.id).not.toBe(token);
  });

  it('rejects an expired session even though its row still exists', async () => {
    const { cookie } = await signedIn();
    t.clock.advance(30 * DAY + 1);
    expect((await client(t.app, cookie).get('/me')).status).toBe(401);
  });

  it('slides the expiry at most once an hour, reissuing the cookie when it does', async () => {
    const { cookie } = await signedIn();

    t.clock.advance(59 * 60 * 1000);
    const early = await client(t.app, cookie).get('/me');
    expect(early.status).toBe(200);
    expect(setCookies(early)).toEqual([]);

    t.clock.advance(2 * 60 * 1000);
    const refreshed = await client(t.app, cookie).get('/me');
    expect(sessionCookie(refreshed)).toBe(cookie);
    expect(setCookies(refreshed)[0]).toMatch(/Max-Age=2592000; Path=\/; .*HttpOnly; Secure; SameSite=Lax$/);

    // 29 more days: past the original 30-day expiry, but within the refreshed one.
    t.clock.advance(29 * DAY);
    expect((await client(t.app, cookie).get('/me')).status).toBe(200);
  });

  it('logout deletes the session and clears the cookie', async () => {
    const { cookie } = await signedIn();
    const res = await client(t.app, cookie).post('/auth/logout');
    expect(res.status).toBe(204);
    expect(setCookies(res)[0]).toMatch(new RegExp(`^${SESSION_COOKIE}=; Path=/; Expires=Thu, 01 Jan 1970`));
    expect((await client(t.app, cookie).get('/me')).status).toBe(401);
  });

  it('logout without a session still answers 204 and clears the cookie', async () => {
    const res = await client(t.app).post('/auth/logout');
    expect(res.status).toBe(204);
    expect(setCookies(res)).toHaveLength(1);
  });

  it('logout is state-changing, so the CSRF guard refuses it without the app Origin', async () => {
    const { cookie } = await signedIn();
    const res = await http(t.app).post('/api/auth/logout').set('Cookie', cookie).send({});
    expect(res.status).toBe(403);
    expect((await client(t.app, cookie).get('/me')).status).toBe(200);
  });
});
```

Run: `pnpm --filter @wishlist/api exec vitest run --project integration test/sessions.int-spec.ts`
Expected: FAIL, because `../src/auth/sessions.service.js` can't be resolved.

- [ ] **Step 6: Implement sessions, the guard, the routes and the module**

`apps/api/src/auth/sessions.service.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt } from 'drizzle-orm';
import { CLOCK, type Clock } from '../core/clock.js';
import { DB, type Database } from '../db/database.module.js';
import { sessions, users } from '../db/schema.js';
import { hashToken, newToken } from '../security/tokens.js';
import { SESSION_REFRESH_MS, SESSION_TTL_MS } from './session-cookie.js';

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
}

export interface ActiveSession {
  sessionId: string;
  user: SessionUser;
  /** What the cookie's Max-Age should be now. */
  maxAgeMs: number;
  /** The expiry slid forward on this request, so the cookie must be reissued. */
  refreshed: boolean;
}

/** Database sessions (spec §6.1, D16): revocable at once, at the cost of one indexed lookup. */
@Injectable()
export class SessionsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async create(userId: string): Promise<{ token: string; maxAgeMs: number }> {
    const now = this.clock.now();
    const token = newToken(32);
    await this.db.insert(sessions).values({
      id: hashToken(token),
      userId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    });
    return { token, maxAgeMs: SESSION_TTL_MS };
  }

  /** The live session for a token. Its expiry slides forward at most once an hour. */
  async resolve(token: string): Promise<ActiveSession | null> {
    const now = this.clock.now();
    const sessionId = hashToken(token);
    const [row] = await this.db
      .select({
        lastSeenAt: sessions.lastSeenAt,
        expiresAt: sessions.expiresAt,
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, now)));
    if (!row) return null;

    const user: SessionUser = {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      emailVerified: row.emailVerifiedAt !== null,
    };
    if (now.getTime() - row.lastSeenAt.getTime() < SESSION_REFRESH_MS) {
      return {
        sessionId,
        user,
        maxAgeMs: row.expiresAt.getTime() - now.getTime(),
        refreshed: false,
      };
    }
    await this.db
      .update(sessions)
      .set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) })
      .where(eq(sessions.id, sessionId));
    return { sessionId, user, maxAgeMs: SESSION_TTL_MS, refreshed: true };
  }

  async revoke(token: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.id, hashToken(token)));
  }
}
```

`apps/api/src/auth/session.guard.ts`:
```ts
import {
  createParamDecorator,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { unauthenticated } from '../http/errors.js';
import { readSessionToken, setSessionCookie } from './session-cookie.js';
import { SessionsService, type SessionUser } from './sessions.service.js';

export interface AuthContext {
  sessionId: string;
  user: SessionUser;
}

type AuthenticatedRequest = Request & { auth?: AuthContext };

/**
 * Requires a live session. It attaches the session to the request and reissues the cookie when
 * the expiry slid. Every authorization decision is made here, in the API (spec §6.1).
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(SessionsService) private readonly sessions: SessionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<AuthenticatedRequest>();
    const token = readSessionToken(req.headers.cookie);
    const session = token ? await this.sessions.resolve(token) : null;
    if (!token || !session) throw unauthenticated();
    if (session.refreshed) {
      setSessionCookie(http.getResponse<Response>(), token, session.maxAgeMs);
    }
    req.auth = { sessionId: session.sessionId, user: session.user };
    return true;
  }
}

/** The session SessionGuard attached. Use it only on guarded routes. */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const auth = ctx.switchToHttp().getRequest<AuthenticatedRequest>().auth;
    if (!auth) throw new Error('@CurrentAuth() used on a route without SessionGuard');
    return auth;
  },
);
```

`apps/api/src/auth/me.controller.ts`:
```ts
import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import type { MeResponse } from '@wishlist/contracts';
import { CurrentAuth, SessionGuard, type AuthContext } from './session.guard.js';

/** The signed-in user. Unverified users may use it too (spec §5). */
@Controller('me')
@UseGuards(SessionGuard)
export class MeController {
  @Get()
  @Header('Cache-Control', 'no-store')
  get(@CurrentAuth() auth: AuthContext): MeResponse {
    return auth.user;
  }
}
```

`apps/api/src/auth/session.controller.ts`:
```ts
import { Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { clearSessionCookie, readSessionToken } from './session-cookie.js';
import { SessionsService } from './sessions.service.js';

@Controller('auth')
export class SessionController {
  constructor(@Inject(SessionsService) private readonly sessions: SessionsService) {}

  /** Idempotent: 204 and a cleared cookie, whether or not a live session came with it. */
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = readSessionToken(req.headers.cookie);
    if (token) await this.sessions.revoke(token);
    clearSessionCookie(res);
  }
}
```

`apps/api/src/auth/auth.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import { SecurityModule } from '../security/security.module.js';
import { MeController } from './me.controller.js';
import { SessionController } from './session.controller.js';
import { SessionGuard } from './session.guard.js';
import { SessionsService } from './sessions.service.js';

/** Accounts and sessions (spec §5 Auth, §6.1–§6.6). */
@Module({
  imports: [RateLimitModule, SecurityModule, EmailModule],
  controllers: [SessionController, MeController],
  providers: [SessionsService, SessionGuard],
})
export class AuthModule {}
```

Replace `apps/api/src/app.module.ts` with:
```ts
import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { CoreModule } from './core/core.module.js';
import { DatabaseModule } from './db/database.module.js';
import { HealthModule } from './health/health.module.js';
import { HttpSecurityModule } from './http/http-security.module.js';

@Module({
  imports: [CoreModule, DatabaseModule, HttpSecurityModule, HealthModule, AuthModule],
})
export class AppModule {}
```

Run: `pnpm --filter @wishlist/api exec vitest run --project integration test/sessions.int-spec.ts`
Expected: PASS, 8 tests.

- [ ] **Step 7: Smoke-test the auth module on every preview and deploy (read-only)**

Replace `e2e/tests/smoke/smoke.spec.ts` with:
```ts
import { expect, test } from '@playwright/test';
import { ErrorCode, HealthResponseSchema, ProblemSchema } from '@wishlist/contracts';

// Read-only by design (spec §8): smoke tests run against previews and production.
const expectedSha = process.env.EXPECTED_SHA;

test('API is healthy through the web origin', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  const body = HealthResponseSchema.parse(await res.json());
  expect(body.status).toBe('ok');
  expect(body.db.ok).toBe(true);
  if (expectedSha) expect(body.sha).toBe(expectedSha);
});

test('auth is live: /api/me without a session answers 401 UNAUTHENTICATED', async ({ request }) => {
  const res = await request.get('/api/me');
  expect(res.status()).toBe(401);
  expect(ProblemSchema.parse(await res.json()).code).toBe(ErrorCode.UNAUTHENTICATED);
});

test('landing page renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Wishlist' })).toBeVisible();
});
```

**Why:** the API's boot now loads argon2's native binding, through `AuthModule`, then `SecurityModule`, then the services that import `passwords.ts`. That happens from Task 7 on. A preview whose bundle missed the `.node` file would fail its health wait. This smoke test also proves `/api/me` is routed through the web origin.

- [ ] **Step 8: Gate, commit and submit**

```bash
API_ORIGIN=http://localhost:3001 pnpm turbo run lint typecheck test build
pnpm turbo run test:integration --filter=@wishlist/api
pnpm test:e2e
pnpm format:check
git add apps/api e2e/tests/smoke/smoke.spec.ts
git commit -F - <<'EOF'
feat(api): add database sessions, GET /me and logout

Sessions live in Postgres behind a __Host- cookie holding a 256-bit token
whose SHA-256 is the row id. Expiry slides at most hourly, and the cookie
is reissued when it does (spec §6.1). Logout is idempotent. The smoke
test now checks /api/me answers 401 through the web origin.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
gh stack submit --open
```

Expected: everything passes. The PR's preview `smoke` job passes the new test.

---

### Task 7: Signup, email verification and resend

**Files:**
- Modify: `apps/api/src/db/database.module.ts` (adds the `Transaction` type), `apps/api/src/auth/auth.module.ts`
- Create in `apps/api/src/auth/`: `auth-errors.ts`, `rate-limits.ts`, `users.ts`, `email-tokens.service.ts`, `auth-emails.ts`, `email-gate.ts`, `signup.service.ts`, `signup.controller.ts`
- Create: `apps/api/test/support/accounts.ts`
- Test: `apps/api/src/auth/auth-emails.spec.ts`, `apps/api/test/signup.int-spec.ts`

**Interfaces:**
- **Consumes:**
  - From Task 2: the `users`, `wishlists` and `emailTokens` tables, and `EmailTokenPurpose`.
  - From Task 4: `newId`, `newToken`, `hashToken`, `hashPassword`, `PasswordPolicy` and `CAPTCHA_VERIFIER`.
  - From Task 3: `RateLimiter.enforce`, `rateLimitKey`, `ZodValidationPipe` and `@ClientIp()`.
  - From Task 5: `Mailer`.
  - From Task 6: `createAuthTestApp` and `client`.
- **Produces, types and errors:**
  - `type Transaction`.
  - `invalidToken()`, `captchaFailed()`, `captchaUnavailable()`, `invalidCredentials()` (401) and `wrongPassword()` (403). The last two are used in Tasks 8 and 10.
  - `MAIL_PER_EMAIL`, `MAIL_PER_IP`, `LOGIN_PER_EMAIL` and `LOGIN_PER_IP`.
- **Produces, services:**
  - `findUserByEmail(db, email)`.
  - `EmailTokensService.issue(tx, userId, purpose): Promise<string>` and `.consume(tx, token, purpose): Promise<string | null>`. Task 9 adds `.peek`.
  - `EmailGate.admit(email, turnstileToken, ip)`.
  - `AuthEmails.verification(to, displayName, token)`, `.accountExists(to)` and `.passwordReset(to, token)`.
  - `SUBJECTS`.
- **Produces, routes:** `POST /auth/signup` (202), `POST /auth/verify-email` (204) and `POST /auth/resend-verification` (202).
- **Produces, test helpers:** `ADA`, `TURNSTILE_OK`, `lastEmail(t, to, subject)`, `signUp(t, account?)` and `signUpVerified(t, account?)`.

- [ ] **Step 1: Add the stack layer**

```bash
gh stack add api/signup
```

- [ ] **Step 2: Write the failing email-template tests**

`apps/api/src/auth/auth-emails.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  accountExistsEmail,
  passwordResetEmail,
  SUBJECTS,
  verificationEmail,
} from './auth-emails.js';

const ORIGIN = 'https://wishlist.example';
const TOKEN = 'T'.repeat(43);

describe('account emails', () => {
  it('links verification to /verify-email with the token, in text and in HTML', () => {
    const email = verificationEmail(ORIGIN, 'Ada', TOKEN);
    expect(email.subject).toBe(SUBJECTS.verification);
    expect(email.text).toContain(`${ORIGIN}/verify-email?token=${TOKEN}`);
    expect(email.html).toContain(`href="${ORIGIN}/verify-email?token=${TOKEN}"`);
    expect(email.text).toContain('Hi Ada,');
  });

  it('escapes the display name in HTML', () => {
    const { html } = verificationEmail(ORIGIN, '<b>Ada</b>', TOKEN);
    expect(html).toContain('&lt;b&gt;Ada&lt;/b&gt;');
    expect(html).not.toContain('<b>Ada</b>');
  });

  it('answers a signup for an existing account with links to log in and to reset, and no token', () => {
    const email = accountExistsEmail(ORIGIN);
    expect(email.subject).toBe(SUBJECTS.accountExists);
    expect(email.text).toContain(`${ORIGIN}/login`);
    expect(email.text).toContain(`${ORIGIN}/reset-password`);
    expect(email.text).not.toContain('token=');
  });

  it('links a reset to /reset-password/confirm with the token', () => {
    const email = passwordResetEmail(ORIGIN, TOKEN);
    expect(email.subject).toBe(SUBJECTS.passwordReset);
    expect(email.text).toContain(`${ORIGIN}/reset-password/confirm?token=${TOKEN}`);
  });
});
```

Run: `pnpm --filter @wishlist/api exec vitest run --project unit src/auth/auth-emails.spec.ts`
Expected: FAIL, because `./auth-emails.js` can't be resolved.

- [ ] **Step 3: Implement the emails**

`apps/api/src/auth/auth-emails.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../core/env.js';
import type { EmailMessage } from '../email/email-sender.js';
import { Mailer } from '../email/mailer.js';

export const SUBJECTS = {
  verification: 'Confirm your email for Wishlist',
  accountExists: 'You already have a Wishlist account',
  passwordReset: 'Reset your Wishlist password',
} as const;

type Rendered = Omit<EmailMessage, 'to'>;

interface Link {
  label: string;
  href: string;
}

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

/** Plain text first; the HTML says the same words, with every value escaped. */
function compose(
  subject: string,
  intro: readonly string[],
  links: readonly Link[],
  footer: string,
): Rendered {
  return {
    subject,
    text: [...intro, ...links.map((l) => `${l.label}: ${l.href}`), footer].join('\n\n'),
    html: [
      ...intro.map((p) => `<p>${escapeHtml(p)}</p>`),
      ...links.map((l) => `<p><a href="${escapeHtml(l.href)}">${escapeHtml(l.label)}</a></p>`),
      `<p>${escapeHtml(footer)}</p>`,
    ].join('\n'),
  };
}

export function verificationEmail(appOrigin: string, displayName: string, token: string): Rendered {
  return compose(
    SUBJECTS.verification,
    [`Hi ${displayName},`, 'Confirm your email address to start your wishlist.'],
    [{ label: 'Confirm your email', href: `${appOrigin}/verify-email?token=${token}` }],
    "This link expires in 24 hours. If you didn't sign up, ignore this email.",
  );
}

export function accountExistsEmail(appOrigin: string): Rendered {
  return compose(
    SUBJECTS.accountExists,
    ['Someone tried to sign up for Wishlist with this email address, but it already has an account.'],
    [
      { label: 'Log in', href: `${appOrigin}/login` },
      { label: 'Forgot your password? Reset it', href: `${appOrigin}/reset-password` },
    ],
    "If this wasn't you, ignore this email. Nothing has changed.",
  );
}

export function passwordResetEmail(appOrigin: string, token: string): Rendered {
  return compose(
    SUBJECTS.passwordReset,
    ['Use this link to choose a new password. It works once, within one hour.'],
    [{ label: 'Reset your password', href: `${appOrigin}/reset-password/confirm?token=${token}` }],
    "Resetting signs you out on every device. If you didn't ask for this, ignore this email.",
  );
}

/** Queues the account emails (spec §5). Their links point at the web app, APP_ORIGIN. */
@Injectable()
export class AuthEmails {
  constructor(
    @Inject(Mailer) private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
  ) {}

  verification(to: string, displayName: string, token: string): void {
    this.mailer.queue({ to, ...verificationEmail(this.env.APP_ORIGIN, displayName, token) });
  }

  accountExists(to: string): void {
    this.mailer.queue({ to, ...accountExistsEmail(this.env.APP_ORIGIN) });
  }

  passwordReset(to: string, token: string): void {
    this.mailer.queue({ to, ...passwordResetEmail(this.env.APP_ORIGIN, token) });
  }
}
```

Run the command from Step 2 again.
Expected: PASS, 4 tests.

- [ ] **Step 4: Write the failing signup tests, with their helpers**

`apps/api/test/support/accounts.ts`:
```ts
import { SUBJECTS } from '../../src/auth/auth-emails.js';
import type { EmailMessage } from '../../src/email/email-sender.js';
import type { AuthTestApp } from './auth-app.js';
import { client, linkToken } from './client.js';

export interface Account {
  email: string;
  password: string;
  displayName: string;
}

export const ADA: Account = {
  email: 'ada@example.com',
  password: 'correct horse battery 1',
  displayName: 'Ada',
};

/** Any token works against FakeCaptcha. Tests flip `t.captcha.verdict` to fail it. */
export const TURNSTILE_OK = 'turnstile-ok';

/** The last email with this subject sent to this address. */
export function lastEmail(t: AuthTestApp, to: string, subject: string): EmailMessage {
  const message = t.emails.sent.findLast((m) => m.to === to && m.subject === subject);
  if (!message) throw new Error(`no "${subject}" email to ${to}`);
  return message;
}

export async function signUp(t: AuthTestApp, account: Account = ADA): Promise<void> {
  const res = await client(t.app).post('/auth/signup', { ...account, turnstileToken: TURNSTILE_OK });
  if (res.status !== 202) throw new Error(`signup answered ${res.status}`);
}

/** Signs up, then follows the emailed verification link. */
export async function signUpVerified(t: AuthTestApp, account: Account = ADA): Promise<void> {
  await signUp(t, account);
  const token = linkToken(lastEmail(t, account.email, SUBJECTS.verification).text);
  const res = await client(t.app).post('/auth/verify-email', { token });
  if (res.status !== 204) throw new Error(`verify answered ${res.status}`);
}
```

`apps/api/test/signup.int-spec.ts`:
```ts
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
    const { rows } = await db.pool.query<{ password_hash: string }>('select password_hash from users');
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
      client(t.app).post('/auth/resend-verification', { email: ADA.email, turnstileToken: TURNSTILE_OK });
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
      const res = await client(t.app).post('/auth/signup', { ...SIGNUP, email: `user${i}@example.com` });
      expect(res.status).toBe(202);
    }
    const limited = await client(t.app).post('/auth/signup', { ...SIGNUP, email: 'user20@example.com' });
    expect(limited.status).toBe(429);
  });
});

describe('POST /auth/verify-email (spec §5, §6.5)', () => {
  const tokenFor = (email = ADA.email) => linkToken(lastEmail(t, email, SUBJECTS.verification).text);

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
```

Run: `pnpm --filter @wishlist/api exec vitest run --project integration test/signup.int-spec.ts`
Expected: FAIL. Every request answers `404 NOT_FOUND`, because the routes don't exist.

- [ ] **Step 5: Implement signup, verification and resend**

In `apps/api/src/db/database.module.ts`, add this line directly below `export type Database = NodePgDatabase<typeof schema>;`:
```ts
/** A transaction handle: what `db.transaction(async (tx) => …)` passes in. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
```

`apps/api/src/auth/auth-errors.ts`:
```ts
import { ErrorCode } from '@wishlist/contracts';
import { AppError } from '../http/app-error.js';

// Account failures. As everywhere, no detail echoes what the caller sent.

export const invalidToken = (): AppError =>
  new AppError(400, ErrorCode.INVALID_TOKEN, 'This link is invalid or has expired.');

export const captchaFailed = (): AppError =>
  new AppError(400, ErrorCode.CAPTCHA_FAILED, 'The human check failed. Try again.');

export const captchaUnavailable = (): AppError =>
  new AppError(503, ErrorCode.CAPTCHA_UNAVAILABLE, "We can't check requests right now. Try again later.");

/** Login (spec §5): the same answer for an unknown email and a wrong password. */
export const invalidCredentials = (): AppError =>
  new AppError(401, ErrorCode.INVALID_CREDENTIALS, 'Email or password is incorrect.');

/** A signed-in user confirmed the wrong password. 403, because a 401 would read as "signed out". */
export const wrongPassword = (): AppError =>
  new AppError(403, ErrorCode.INVALID_CREDENTIALS, 'That password is incorrect.');
```

`apps/api/src/auth/rate-limits.ts`:
```ts
import type { RateLimitRule } from '../rate-limit/window.js';

/**
 * Spec §6.6. Signup, resend-verification and reset-request share these two buckets: together they
 * cap how much mail one address, or one IP, can trigger.
 */
export const MAIL_PER_EMAIL: RateLimitRule = { limit: 3, windowSeconds: 3600 };
export const MAIL_PER_IP: RateLimitRule = { limit: 20, windowSeconds: 3600 };

/** Spec §6.6. Password confirmations on /me count against the same per-address bucket. */
export const LOGIN_PER_EMAIL: RateLimitRule = { limit: 10, windowSeconds: 900 };
export const LOGIN_PER_IP: RateLimitRule = { limit: 50, windowSeconds: 900 };
```

`apps/api/src/auth/users.ts`:
```ts
import { sql } from 'drizzle-orm';
import type { Database } from '../db/database.module.js';
import { users } from '../db/schema.js';

/**
 * The account for an address. The contracts have already lowercased it. Comparing on lower(email)
 * lets the unique index serve the lookup.
 */
export async function findUserByEmail(db: Database, email: string) {
  const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
  return user;
}
```

`apps/api/src/auth/email-tokens.service.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { CLOCK, type Clock } from '../core/clock.js';
import { newId } from '../core/ids.js';
import type { Transaction } from '../db/database.module.js';
import { emailTokens, type EmailTokenPurpose } from '../db/schema.js';
import { hashToken, newToken } from '../security/tokens.js';

/** Spec §6.5: verify links last 24 hours, reset links 1 hour. */
export const EMAIL_TOKEN_TTL_MS: Readonly<Record<EmailTokenPurpose, number>> = {
  verify_email: 24 * 60 * 60 * 1000,
  reset_password: 60 * 60 * 1000,
};

/** Single-use email-link tokens. Only their SHA-256 is stored (spec §4, §6.5). */
@Injectable()
export class EmailTokensService {
  constructor(@Inject(CLOCK) private readonly clock: Clock) {}

  /** A fresh token. Any earlier unused token for the same purpose stops working. */
  async issue(tx: Transaction, userId: string, purpose: EmailTokenPurpose): Promise<string> {
    const now = this.clock.now();
    const token = newToken(32);
    await tx
      .delete(emailTokens)
      .where(
        and(
          eq(emailTokens.userId, userId),
          eq(emailTokens.purpose, purpose),
          isNull(emailTokens.consumedAt),
        ),
      );
    await tx.insert(emailTokens).values({
      id: newId(),
      userId,
      purpose,
      tokenHash: hashToken(token),
      createdAt: now,
      expiresAt: new Date(now.getTime() + EMAIL_TOKEN_TTL_MS[purpose]),
    });
    return token;
  }

  /**
   * Uses up a live token inside the caller's transaction and returns its user. Returns null if
   * the token is unknown, expired or already used. FOR UPDATE makes a concurrent second use wait,
   * then find the token consumed.
   */
  async consume(tx: Transaction, token: string, purpose: EmailTokenPurpose): Promise<string | null> {
    const now = this.clock.now();
    const [row] = await tx
      .select({ id: emailTokens.id, userId: emailTokens.userId })
      .from(emailTokens)
      .where(
        and(
          eq(emailTokens.tokenHash, hashToken(token)),
          eq(emailTokens.purpose, purpose),
          isNull(emailTokens.consumedAt),
          gt(emailTokens.expiresAt, now),
        ),
      )
      .for('update');
    if (!row) return null;
    await tx.update(emailTokens).set({ consumedAt: now }).where(eq(emailTokens.id, row.id));
    return row.userId;
  }
}
```

`apps/api/src/auth/email-gate.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import { rateLimitKey } from '../rate-limit/keys.js';
import { RateLimiter } from '../rate-limit/rate-limiter.js';
import { CAPTCHA_VERIFIER, type CaptchaVerifier } from '../security/captcha.js';
import { captchaFailed, captchaUnavailable } from './auth-errors.js';
import { MAIL_PER_EMAIL, MAIL_PER_IP } from './rate-limits.js';

/**
 * The checks in front of every endpoint that emails an address the caller supplied: signup,
 * resend-verification and reset-request (spec §6.5, §6.6). The per-IP limit comes first, so
 * floods never reach Cloudflare. Turnstile comes before the per-address limit, so a bot can't use
 * up a victim's three emails an hour without solving a challenge.
 */
@Injectable()
export class EmailGate {
  constructor(
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(CAPTCHA_VERIFIER) private readonly captcha: CaptchaVerifier,
  ) {}

  async admit(email: string, turnstileToken: string, ip: string): Promise<void> {
    await this.limiter.enforce(rateLimitKey('mail:ip', ip), MAIL_PER_IP);
    const verdict = await this.captcha.verify(turnstileToken, ip);
    if (verdict === 'unavailable') throw captchaUnavailable();
    if (verdict === 'failed') throw captchaFailed();
    await this.limiter.enforce(rateLimitKey('mail:email', email), MAIL_PER_EMAIL);
  }
}
```

`apps/api/src/auth/signup.service.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { ResendVerificationRequest, SignupRequest } from '@wishlist/contracts';
import { and, eq, isNull } from 'drizzle-orm';
import { CLOCK, type Clock } from '../core/clock.js';
import { newId } from '../core/ids.js';
import { DB, type Database } from '../db/database.module.js';
import { users, wishlists } from '../db/schema.js';
import { PasswordPolicy } from '../security/password-policy.js';
import { hashPassword } from '../security/passwords.js';
import { newToken } from '../security/tokens.js';
import { invalidToken } from './auth-errors.js';
import { AuthEmails } from './auth-emails.js';
import { EmailGate } from './email-gate.js';
import { EmailTokensService } from './email-tokens.service.js';
import { findUserByEmail } from './users.js';

@Injectable()
export class SignupService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(EmailGate) private readonly gate: EmailGate,
    @Inject(PasswordPolicy) private readonly passwordPolicy: PasswordPolicy,
    @Inject(EmailTokensService) private readonly tokens: EmailTokensService,
    @Inject(AuthEmails) private readonly emails: AuthEmails,
  ) {}

  /**
   * Spec §5. A new address gets an account, its wishlist (spec §2) and a verification email. An
   * existing address gets an "already have an account" email instead, and the response is the same
   * either way.
   */
  async signup(input: SignupRequest, ip: string): Promise<void> {
    await this.gate.admit(input.email, input.turnstileToken, ip);
    await this.passwordPolicy.assertNotBreached(input.password);
    // Hash before looking the address up, so both outcomes take the same time.
    const passwordHash = await hashPassword(input.password);
    const now = this.clock.now();

    const verifyToken = await this.db.transaction(async (tx) => {
      const userId = newId();
      // DO NOTHING covers the unique lower(email) index, including a concurrent signup.
      const [created] = await tx
        .insert(users)
        .values({
          id: userId,
          email: input.email,
          passwordHash,
          displayName: input.displayName,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: users.id });
      if (!created) return null;
      await tx.insert(wishlists).values({
        id: newId(),
        ownerId: userId,
        title: `${input.displayName}'s wishlist`,
        shareToken: newToken(16),
        createdAt: now,
        updatedAt: now,
      });
      return this.tokens.issue(tx, userId, 'verify_email');
    });

    if (verifyToken) this.emails.verification(input.email, input.displayName, verifyToken);
    else this.emails.accountExists(input.email);
  }

  async verifyEmail(token: string): Promise<void> {
    const now = this.clock.now();
    const verified = await this.db.transaction(async (tx) => {
      const userId = await this.tokens.consume(tx, token, 'verify_email');
      if (!userId) return false;
      await tx
        .update(users)
        .set({ emailVerifiedAt: now, updatedAt: now })
        .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)));
      return true;
    });
    if (!verified) throw invalidToken();
  }

  /** Spec §5: always 202. Only an unverified account gets an email. */
  async resendVerification(input: ResendVerificationRequest, ip: string): Promise<void> {
    await this.gate.admit(input.email, input.turnstileToken, ip);
    const user = await findUserByEmail(this.db, input.email);
    if (!user || user.emailVerifiedAt) return;
    const token = await this.db.transaction((tx) => this.tokens.issue(tx, user.id, 'verify_email'));
    this.emails.verification(user.email, user.displayName, token);
  }
}
```

`apps/api/src/auth/signup.controller.ts`:
```ts
import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import {
  ResendVerificationRequestSchema,
  SignupRequestSchema,
  VerifyEmailRequestSchema,
  type ResendVerificationRequest,
  type SignupRequest,
  type VerifyEmailRequest,
} from '@wishlist/contracts';
import { ClientIp } from '../http/client-ip.js';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { SignupService } from './signup.service.js';

@Controller('auth')
export class SignupController {
  constructor(@Inject(SignupService) private readonly service: SignupService) {}

  /** 202 whether or not the address already had an account (spec §5). */
  @Post('signup')
  @HttpCode(202)
  async signup(
    @Body(new ZodValidationPipe(SignupRequestSchema)) body: SignupRequest,
    @ClientIp() ip: string,
  ): Promise<void> {
    await this.service.signup(body, ip);
  }

  @Post('verify-email')
  @HttpCode(204)
  async verifyEmail(
    @Body(new ZodValidationPipe(VerifyEmailRequestSchema)) body: VerifyEmailRequest,
  ): Promise<void> {
    await this.service.verifyEmail(body.token);
  }

  @Post('resend-verification')
  @HttpCode(202)
  async resendVerification(
    @Body(new ZodValidationPipe(ResendVerificationRequestSchema)) body: ResendVerificationRequest,
    @ClientIp() ip: string,
  ): Promise<void> {
    await this.service.resendVerification(body, ip);
  }
}
```

Replace `apps/api/src/auth/auth.module.ts` with:
```ts
import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import { SecurityModule } from '../security/security.module.js';
import { AuthEmails } from './auth-emails.js';
import { EmailGate } from './email-gate.js';
import { EmailTokensService } from './email-tokens.service.js';
import { MeController } from './me.controller.js';
import { SessionController } from './session.controller.js';
import { SessionGuard } from './session.guard.js';
import { SessionsService } from './sessions.service.js';
import { SignupController } from './signup.controller.js';
import { SignupService } from './signup.service.js';

/** Accounts and sessions (spec §5 Auth, §6.1–§6.6). */
@Module({
  imports: [RateLimitModule, SecurityModule, EmailModule],
  controllers: [SessionController, MeController, SignupController],
  providers: [
    SessionsService,
    SessionGuard,
    EmailTokensService,
    EmailGate,
    AuthEmails,
    SignupService,
  ],
})
export class AuthModule {}
```

Run: `pnpm --filter @wishlist/api exec vitest run --project integration test/signup.int-spec.ts`
Expected: PASS, 16 tests: 11 for signup, 3 for verify, 2 for resend. The per-IP test hashes 21 passwords, so this file takes a few seconds.

- [ ] **Step 6: Gate, commit and submit**

```bash
API_ORIGIN=http://localhost:3001 pnpm turbo run lint typecheck test build
pnpm turbo run test:integration --filter=@wishlist/api
pnpm format:check
git add apps/api
git commit -F - <<'EOF'
feat(api): add signup, email verification and resend-verification

Signup always answers 202. A new address gets an account, its wishlist
and a verification link; an existing one gets an "already have an
account" email instead (spec §5, §8). The password is hashed before the
lookup so both paths take the same time. Email-sending endpoints check
the per-IP limit, then Turnstile, then the per-address limit.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
gh stack submit --open
```

Expected: everything passes. The PR's preview boots with argon2 loaded, and health and smoke pass.

---

### Task 8: Login

**Files:**
- Create: `apps/api/src/auth/login.service.ts`
- Modify: `apps/api/src/auth/session.controller.ts`, `apps/api/src/auth/auth.module.ts`, `apps/api/test/support/accounts.ts`
- Test: `apps/api/test/login.int-spec.ts`

**Interfaces:**
- **Consumes:**
  - From Task 6: `SessionsService.create` and `setSessionCookie`.
  - From Task 4: `verifyPassword` and `burnPasswordCheck`.
  - From Task 7: `findUserByEmail`, `invalidCredentials`, `LOGIN_PER_EMAIL`, `LOGIN_PER_IP`, `signUp` and `signUpVerified`.
  - From Task 3: `rateLimitKey` and `RateLimiter.enforce`.
- **Produces:**
  - `LoginService.login(input, ip): Promise<{ token, maxAgeMs }>`.
  - `POST /auth/login`, which answers 204 and sets the cookie.
  - The test helper `logIn(t, account?)`, which returns the `__Host-session=…` cookie.

- [ ] **Step 1: Add the stack layer**

```bash
gh stack add api/login
```

- [ ] **Step 2: Write the failing tests**

Replace `apps/api/test/support/accounts.ts` with the following. It's the Task 7 file plus `logIn`:
```ts
import { SUBJECTS } from '../../src/auth/auth-emails.js';
import type { EmailMessage } from '../../src/email/email-sender.js';
import type { AuthTestApp } from './auth-app.js';
import { client, linkToken, sessionCookie } from './client.js';

export interface Account {
  email: string;
  password: string;
  displayName: string;
}

export const ADA: Account = {
  email: 'ada@example.com',
  password: 'correct horse battery 1',
  displayName: 'Ada',
};

/** Any token works against FakeCaptcha. Tests flip `t.captcha.verdict` to fail it. */
export const TURNSTILE_OK = 'turnstile-ok';

/** The last email with this subject sent to this address. */
export function lastEmail(t: AuthTestApp, to: string, subject: string): EmailMessage {
  const message = t.emails.sent.findLast((m) => m.to === to && m.subject === subject);
  if (!message) throw new Error(`no "${subject}" email to ${to}`);
  return message;
}

export async function signUp(t: AuthTestApp, account: Account = ADA): Promise<void> {
  const res = await client(t.app).post('/auth/signup', { ...account, turnstileToken: TURNSTILE_OK });
  if (res.status !== 202) throw new Error(`signup answered ${res.status}`);
}

/** Signs up, then follows the emailed verification link. */
export async function signUpVerified(t: AuthTestApp, account: Account = ADA): Promise<void> {
  await signUp(t, account);
  const token = linkToken(lastEmail(t, account.email, SUBJECTS.verification).text);
  const res = await client(t.app).post('/auth/verify-email', { token });
  if (res.status !== 204) throw new Error(`verify answered ${res.status}`);
}

/** Logs in and returns the session cookie to send back. */
export async function logIn(
  t: AuthTestApp,
  credentials: Pick<Account, 'email' | 'password'> = ADA,
): Promise<string> {
  const res = await client(t.app).post('/auth/login', {
    email: credentials.email,
    password: credentials.password,
  });
  if (res.status !== 204) throw new Error(`login answered ${res.status}`);
  return sessionCookie(res);
}
```

`apps/api/test/login.int-spec.ts`:
```ts
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
    expect(MeResponseSchema.parse(me.body)).toMatchObject({ email: ADA.email, emailVerified: true });
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
    for (let i = 0; i < 10; i++) expect((await login(ADA.email, 'wrong password')).status).toBe(401);
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
```

Run: `pnpm --filter @wishlist/api exec vitest run --project integration test/login.int-spec.ts`
Expected: FAIL. `POST /api/auth/login` answers 404, and the helpers' `login answered 404` errors follow.

- [ ] **Step 3: Implement login**

`apps/api/src/auth/login.service.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { LoginRequest } from '@wishlist/contracts';
import { DB, type Database } from '../db/database.module.js';
import { rateLimitKey } from '../rate-limit/keys.js';
import { RateLimiter } from '../rate-limit/rate-limiter.js';
import { burnPasswordCheck, verifyPassword } from '../security/passwords.js';
import { invalidCredentials } from './auth-errors.js';
import { LOGIN_PER_EMAIL, LOGIN_PER_IP } from './rate-limits.js';
import { SessionsService } from './sessions.service.js';
import { findUserByEmail } from './users.js';

@Injectable()
export class LoginService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(SessionsService) private readonly sessions: SessionsService,
  ) {}

  /**
   * Spec §5, §6.4, §6.6. Both limits apply before the lookup, so a 429 says nothing about whether
   * the address exists. An unknown address still costs a full argon2 check. Unverified users may
   * log in; owner endpoints check verification (Plan 3).
   */
  async login(input: LoginRequest, ip: string): Promise<{ token: string; maxAgeMs: number }> {
    await this.limiter.enforce(rateLimitKey('login:ip', ip), LOGIN_PER_IP);
    await this.limiter.enforce(rateLimitKey('login:email', input.email), LOGIN_PER_EMAIL);
    const user = await findUserByEmail(this.db, input.email);
    if (!user) {
      await burnPasswordCheck(input.password);
      throw invalidCredentials();
    }
    if (!(await verifyPassword(user.passwordHash, input.password))) throw invalidCredentials();
    return this.sessions.create(user.id);
  }
}
```

Replace `apps/api/src/auth/session.controller.ts` with:
```ts
import { Body, Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { LoginRequestSchema, type LoginRequest } from '@wishlist/contracts';
import type { Request, Response } from 'express';
import { ClientIp } from '../http/client-ip.js';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { LoginService } from './login.service.js';
import { clearSessionCookie, readSessionToken, setSessionCookie } from './session-cookie.js';
import { SessionsService } from './sessions.service.js';

@Controller('auth')
export class SessionController {
  constructor(
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(LoginService) private readonly logins: LoginService,
  ) {}

  /** 204 with the session cookie, or 401 INVALID_CREDENTIALS (spec §5). */
  @Post('login')
  @HttpCode(204)
  async login(
    @Body(new ZodValidationPipe(LoginRequestSchema)) body: LoginRequest,
    @ClientIp() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const session = await this.logins.login(body, ip);
    setSessionCookie(res, session.token, session.maxAgeMs);
  }

  /** Idempotent: 204 and a cleared cookie, whether or not a live session came with it. */
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = readSessionToken(req.headers.cookie);
    if (token) await this.sessions.revoke(token);
    clearSessionCookie(res);
  }
}
```

Replace `apps/api/src/auth/auth.module.ts` with:
```ts
import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import { SecurityModule } from '../security/security.module.js';
import { AuthEmails } from './auth-emails.js';
import { EmailGate } from './email-gate.js';
import { EmailTokensService } from './email-tokens.service.js';
import { LoginService } from './login.service.js';
import { MeController } from './me.controller.js';
import { SessionController } from './session.controller.js';
import { SessionGuard } from './session.guard.js';
import { SessionsService } from './sessions.service.js';
import { SignupController } from './signup.controller.js';
import { SignupService } from './signup.service.js';

/** Accounts and sessions (spec §5 Auth, §6.1–§6.6). */
@Module({
  imports: [RateLimitModule, SecurityModule, EmailModule],
  controllers: [SessionController, MeController, SignupController],
  providers: [
    SessionsService,
    SessionGuard,
    EmailTokensService,
    EmailGate,
    AuthEmails,
    SignupService,
    LoginService,
  ],
})
export class AuthModule {}
```

Run: `pnpm --filter @wishlist/api exec vitest run --project integration test/login.int-spec.ts`
Expected: PASS, 7 tests. The per-IP test runs 50 dummy argon2 checks, so it takes a few seconds.

- [ ] **Step 4: Gate, commit and submit**

```bash
API_ORIGIN=http://localhost:3001 pnpm turbo run lint typecheck test build
pnpm turbo run test:integration --filter=@wishlist/api
pnpm format:check
git add apps/api
git commit -F - <<'EOF'
feat(api): add login

204 and a __Host- session cookie, or 401 INVALID_CREDENTIALS, the same
for an unknown email as for a wrong password. An unknown email still
costs a full argon2 check (spec §6.4). Both rate limits apply before the
lookup (spec §6.6).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
gh stack submit --open
```

---

### Task 9: Password reset

**Files:**
- Modify: `apps/api/src/auth/email-tokens.service.ts` (adds `peek`), `apps/api/src/auth/auth.module.ts`
- Create: `apps/api/src/auth/password-reset.service.ts`, `apps/api/src/auth/password-reset.controller.ts`
- Test: `apps/api/test/password-reset.int-spec.ts`

**Interfaces:**
- **Consumes:**
  - From Task 7: `EmailGate`, `EmailTokensService`, `AuthEmails.passwordReset`, `findUserByEmail` and `invalidToken`.
  - From Task 4: `PasswordPolicy` and `hashPassword`.
  - From Tasks 7 and 8: the `signUp`, `signUpVerified` and `logIn` helpers.
- **Produces:**
  - `EmailTokensService.peek(db, token, purpose): Promise<string | null>`.
  - `POST /auth/password-reset/request` (202) and `POST /auth/password-reset/confirm` (204).

- [ ] **Step 1: Add the stack layer**

```bash
gh stack add api/password-reset
```

- [ ] **Step 2: Write the failing tests**

`apps/api/test/password-reset.int-spec.ts`:
```ts
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
const login = (password: string) => client(t.app).post('/auth/login', { email: ADA.email, password });

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
    const me = await client(t.app, await logIn(t, { email: ADA.email, password: NEW_PASSWORD })).get('/me');
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
```

Run: `pnpm --filter @wishlist/api exec vitest run --project integration test/password-reset.int-spec.ts`
Expected: FAIL. The reset routes answer 404.

- [ ] **Step 3: Implement reset**

Replace `apps/api/src/auth/email-tokens.service.ts` with the following. It's the Task 7 file plus `peek`, and both share the live-token condition:
```ts
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, type SQL } from 'drizzle-orm';
import { CLOCK, type Clock } from '../core/clock.js';
import { newId } from '../core/ids.js';
import type { Database, Transaction } from '../db/database.module.js';
import { emailTokens, type EmailTokenPurpose } from '../db/schema.js';
import { hashToken, newToken } from '../security/tokens.js';

/** Spec §6.5: verify links last 24 hours, reset links 1 hour. */
export const EMAIL_TOKEN_TTL_MS: Readonly<Record<EmailTokenPurpose, number>> = {
  verify_email: 24 * 60 * 60 * 1000,
  reset_password: 60 * 60 * 1000,
};

/** Single-use email-link tokens. Only their SHA-256 is stored (spec §4, §6.5). */
@Injectable()
export class EmailTokensService {
  constructor(@Inject(CLOCK) private readonly clock: Clock) {}

  /** A fresh token. Any earlier unused token for the same purpose stops working. */
  async issue(tx: Transaction, userId: string, purpose: EmailTokenPurpose): Promise<string> {
    const now = this.clock.now();
    const token = newToken(32);
    await tx
      .delete(emailTokens)
      .where(
        and(
          eq(emailTokens.userId, userId),
          eq(emailTokens.purpose, purpose),
          isNull(emailTokens.consumedAt),
        ),
      );
    await tx.insert(emailTokens).values({
      id: newId(),
      userId,
      purpose,
      tokenHash: hashToken(token),
      createdAt: now,
      expiresAt: new Date(now.getTime() + EMAIL_TOKEN_TTL_MS[purpose]),
    });
    return token;
  }

  /** The user a live token belongs to, without using it up. A cheap check before expensive work. */
  async peek(db: Database, token: string, purpose: EmailTokenPurpose): Promise<string | null> {
    const [row] = await db
      .select({ userId: emailTokens.userId })
      .from(emailTokens)
      .where(this.live(token, purpose));
    return row?.userId ?? null;
  }

  /**
   * Uses up a live token inside the caller's transaction and returns its user. Returns null if
   * the token is unknown, expired or already used. FOR UPDATE makes a concurrent second use wait,
   * then find the token consumed.
   */
  async consume(tx: Transaction, token: string, purpose: EmailTokenPurpose): Promise<string | null> {
    const [row] = await tx
      .select({ id: emailTokens.id, userId: emailTokens.userId })
      .from(emailTokens)
      .where(this.live(token, purpose))
      .for('update');
    if (!row) return null;
    await tx
      .update(emailTokens)
      .set({ consumedAt: this.clock.now() })
      .where(eq(emailTokens.id, row.id));
    return row.userId;
  }

  private live(token: string, purpose: EmailTokenPurpose): SQL | undefined {
    return and(
      eq(emailTokens.tokenHash, hashToken(token)),
      eq(emailTokens.purpose, purpose),
      isNull(emailTokens.consumedAt),
      gt(emailTokens.expiresAt, this.clock.now()),
    );
  }
}
```

`apps/api/src/auth/password-reset.service.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { PasswordResetConfirmRequest, PasswordResetRequest } from '@wishlist/contracts';
import { and, eq, isNull } from 'drizzle-orm';
import { CLOCK, type Clock } from '../core/clock.js';
import { DB, type Database } from '../db/database.module.js';
import { sessions, users } from '../db/schema.js';
import { PasswordPolicy } from '../security/password-policy.js';
import { hashPassword } from '../security/passwords.js';
import { invalidToken } from './auth-errors.js';
import { AuthEmails } from './auth-emails.js';
import { EmailGate } from './email-gate.js';
import { EmailTokensService } from './email-tokens.service.js';
import { findUserByEmail } from './users.js';

@Injectable()
export class PasswordResetService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(EmailGate) private readonly gate: EmailGate,
    @Inject(PasswordPolicy) private readonly passwordPolicy: PasswordPolicy,
    @Inject(EmailTokensService) private readonly tokens: EmailTokensService,
    @Inject(AuthEmails) private readonly emails: AuthEmails,
  ) {}

  /** Spec §5: always 202, whether or not the address has an account. */
  async request(input: PasswordResetRequest, ip: string): Promise<void> {
    await this.gate.admit(input.email, input.turnstileToken, ip);
    const user = await findUserByEmail(this.db, input.email);
    if (!user) return;
    const token = await this.db.transaction((tx) => this.tokens.issue(tx, user.id, 'reset_password'));
    this.emails.passwordReset(user.email, token);
  }

  /**
   * Spec §5. It sets the new password and verifies the address if it wasn't already, since the
   * reset proves the person reads that inbox. Then it revokes every session. The token is checked
   * before the breach check and the hash, so a made-up token can't make the server do that work.
   */
  async confirm(input: PasswordResetConfirmRequest): Promise<void> {
    if (!(await this.tokens.peek(this.db, input.token, 'reset_password'))) throw invalidToken();
    await this.passwordPolicy.assertNotBreached(input.newPassword);
    const passwordHash = await hashPassword(input.newPassword);
    const now = this.clock.now();

    const reset = await this.db.transaction(async (tx) => {
      const userId = await this.tokens.consume(tx, input.token, 'reset_password');
      if (!userId) return false;
      await tx.update(users).set({ passwordHash, updatedAt: now }).where(eq(users.id, userId));
      await tx
        .update(users)
        .set({ emailVerifiedAt: now })
        .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)));
      await tx.delete(sessions).where(eq(sessions.userId, userId));
      return true;
    });
    if (!reset) throw invalidToken();
  }
}
```

`apps/api/src/auth/password-reset.controller.ts`:
```ts
import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import {
  PasswordResetConfirmRequestSchema,
  PasswordResetRequestSchema,
  type PasswordResetConfirmRequest,
  type PasswordResetRequest,
} from '@wishlist/contracts';
import { ClientIp } from '../http/client-ip.js';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { PasswordResetService } from './password-reset.service.js';

@Controller('auth/password-reset')
export class PasswordResetController {
  constructor(@Inject(PasswordResetService) private readonly resets: PasswordResetService) {}

  @Post('request')
  @HttpCode(202)
  async request(
    @Body(new ZodValidationPipe(PasswordResetRequestSchema)) body: PasswordResetRequest,
    @ClientIp() ip: string,
  ): Promise<void> {
    await this.resets.request(body, ip);
  }

  @Post('confirm')
  @HttpCode(204)
  async confirm(
    @Body(new ZodValidationPipe(PasswordResetConfirmRequestSchema))
    body: PasswordResetConfirmRequest,
  ): Promise<void> {
    await this.resets.confirm(body);
  }
}
```

Replace `apps/api/src/auth/auth.module.ts` with:
```ts
import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import { SecurityModule } from '../security/security.module.js';
import { AuthEmails } from './auth-emails.js';
import { EmailGate } from './email-gate.js';
import { EmailTokensService } from './email-tokens.service.js';
import { LoginService } from './login.service.js';
import { MeController } from './me.controller.js';
import { PasswordResetController } from './password-reset.controller.js';
import { PasswordResetService } from './password-reset.service.js';
import { SessionController } from './session.controller.js';
import { SessionGuard } from './session.guard.js';
import { SessionsService } from './sessions.service.js';
import { SignupController } from './signup.controller.js';
import { SignupService } from './signup.service.js';

/** Accounts and sessions (spec §5 Auth, §6.1–§6.6). */
@Module({
  imports: [RateLimitModule, SecurityModule, EmailModule],
  controllers: [SessionController, MeController, SignupController, PasswordResetController],
  providers: [
    SessionsService,
    SessionGuard,
    EmailTokensService,
    EmailGate,
    AuthEmails,
    SignupService,
    LoginService,
    PasswordResetService,
  ],
})
export class AuthModule {}
```

Run: `pnpm --filter @wishlist/api exec vitest run --project integration test/password-reset.int-spec.ts test/signup.int-spec.ts`
Expected: PASS, 25 tests: 9 here, plus the 16 signup tests, which use the refactored token service.

- [ ] **Step 4: Gate, commit and submit**

```bash
API_ORIGIN=http://localhost:3001 pnpm turbo run lint typecheck test build
pnpm turbo run test:integration --filter=@wishlist/api
pnpm format:check
git add apps/api
git commit -F - <<'EOF'
feat(api): add password reset

The request always answers 202. Confirming sets the new password,
verifies an unverified address, and revokes every session (spec §5). The
link works once, for an hour, and a newer request retires it. A made-up
token is refused before any breach check or hashing.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
gh stack submit --open
```

---

### Task 10: The account: `PATCH /me`, `POST /me/password` and `DELETE /me`

**Files:**
- Create: `apps/api/src/auth/account.service.ts`
- Modify: `apps/api/src/auth/me.controller.ts`, `apps/api/src/auth/auth.module.ts`
- Test: `apps/api/test/account.int-spec.ts`

**Interfaces:**
- **Consumes:**
  - From Task 6: `SessionGuard`, `CurrentAuth`, `AuthContext` and `clearSessionCookie`.
  - From Task 4: `PasswordPolicy`, `hashPassword` and `verifyPassword`.
  - From Task 7: `wrongPassword`, `LOGIN_PER_EMAIL` and `rateLimitKey`.
  - From Tasks 7 and 8: the `signUpVerified` and `logIn` helpers.
- **Produces:**
  - `AccountService.updateDisplayName(auth, displayName): Promise<MeResponse>`, `.changePassword(auth, input)` and `.deleteAccount(auth, password)`.
  - `PATCH /me` (200, `MeResponse`), `POST /me/password` (204) and `DELETE /me` (204, clears the cookie).

- [ ] **Step 1: Add the stack layer**

```bash
gh stack add api/account
```

- [ ] **Step 2: Write the failing tests**

`apps/api/test/account.int-spec.ts`:
```ts
import { ErrorCode, MeResponseSchema, ProblemSchema } from '@wishlist/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../src/auth/session-cookie.js';
import { ADA, logIn, signUpVerified } from './support/accounts.js';
import { createAuthTestApp, type AuthTestApp } from './support/auth-app.js';
import { client, setCookies, type ApiResponse } from './support/client.js';
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
const login = (password: string) => client(t.app).post('/auth/login', { email: ADA.email, password });

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
    expect(setCookies(res)[0]).toMatch(new RegExp(`^${SESSION_COOKIE}=; Path=/; Expires=Thu, 01 Jan 1970`));

    for (const cookie of [laptop, phone]) {
      expect((await client(t.app, cookie).get('/me')).status).toBe(401);
    }
    for (const table of ['users', 'wishlists', 'sessions', 'email_tokens']) {
      expect(await count(table)).toBe(0);
    }
    expect((await login(ADA.password)).status).toBe(401);
  });
});
```

Run: `pnpm --filter @wishlist/api exec vitest run --project integration test/account.int-spec.ts`
Expected: FAIL. The new routes answer 404, so the assertions on 200, 204 and 403 fail. The "needs a session" test fails too.

- [ ] **Step 3: Implement the account endpoints**

`apps/api/src/auth/account.service.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { ChangePasswordRequest, MeResponse } from '@wishlist/contracts';
import { and, eq, ne } from 'drizzle-orm';
import { CLOCK, type Clock } from '../core/clock.js';
import { DB, type Database } from '../db/database.module.js';
import { sessions, users } from '../db/schema.js';
import { rateLimitKey } from '../rate-limit/keys.js';
import { RateLimiter } from '../rate-limit/rate-limiter.js';
import { PasswordPolicy } from '../security/password-policy.js';
import { hashPassword, verifyPassword } from '../security/passwords.js';
import { wrongPassword } from './auth-errors.js';
import { LOGIN_PER_EMAIL } from './rate-limits.js';
import type { AuthContext } from './session.guard.js';

/** What a signed-in user can change about their own account (spec §5). */
@Injectable()
export class AccountService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(PasswordPolicy) private readonly passwordPolicy: PasswordPolicy,
  ) {}

  async updateDisplayName(auth: AuthContext, displayName: string): Promise<MeResponse> {
    await this.db
      .update(users)
      .set({ displayName, updatedAt: this.clock.now() })
      .where(eq(users.id, auth.user.id));
    return { ...auth.user, displayName };
  }

  /** Revokes every other session and keeps this one (spec §6.1), in the same transaction. */
  async changePassword(auth: AuthContext, input: ChangePasswordRequest): Promise<void> {
    await this.confirmPassword(auth, input.currentPassword);
    await this.passwordPolicy.assertNotBreached(input.newPassword);
    const passwordHash = await hashPassword(input.newPassword);
    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash, updatedAt: this.clock.now() })
        .where(eq(users.id, auth.user.id));
      await tx
        .delete(sessions)
        .where(and(eq(sessions.userId, auth.user.id), ne(sessions.id, auth.sessionId)));
    });
  }

  /** Deleting the user cascades to the wishlist, sessions and email tokens (spec §4). */
  async deleteAccount(auth: AuthContext, password: string): Promise<void> {
    await this.confirmPassword(auth, password);
    await this.db.delete(users).where(eq(users.id, auth.user.id));
  }

  /**
   * Re-checks the password before a sensitive change. Attempts count against login's per-address
   * bucket, so a stolen session can't be used to brute-force the password.
   */
  private async confirmPassword(auth: AuthContext, password: string): Promise<void> {
    await this.limiter.enforce(rateLimitKey('login:email', auth.user.email), LOGIN_PER_EMAIL);
    const [row] = await this.db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, auth.user.id));
    if (!row || !(await verifyPassword(row.passwordHash, password))) throw wrongPassword();
  }
}
```

Replace `apps/api/src/auth/me.controller.ts` with:
```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ChangePasswordRequestSchema,
  DeleteMeRequestSchema,
  UpdateMeRequestSchema,
  type ChangePasswordRequest,
  type DeleteMeRequest,
  type MeResponse,
  type UpdateMeRequest,
} from '@wishlist/contracts';
import type { Response } from 'express';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { AccountService } from './account.service.js';
import { clearSessionCookie } from './session-cookie.js';
import { CurrentAuth, SessionGuard, type AuthContext } from './session.guard.js';

/** The signed-in user. Unverified users may use all of it (spec §5). */
@Controller('me')
@UseGuards(SessionGuard)
export class MeController {
  constructor(@Inject(AccountService) private readonly account: AccountService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  get(@CurrentAuth() auth: AuthContext): MeResponse {
    return auth.user;
  }

  @Patch()
  update(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(UpdateMeRequestSchema)) body: UpdateMeRequest,
  ): Promise<MeResponse> {
    return this.account.updateDisplayName(auth, body.displayName);
  }

  @Post('password')
  @HttpCode(204)
  async changePassword(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(ChangePasswordRequestSchema)) body: ChangePasswordRequest,
  ): Promise<void> {
    await this.account.changePassword(auth, body);
  }

  @Delete()
  @HttpCode(204)
  async delete(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(DeleteMeRequestSchema)) body: DeleteMeRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.account.deleteAccount(auth, body.password);
    clearSessionCookie(res);
  }
}
```

Replace `apps/api/src/auth/auth.module.ts` with:
```ts
import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import { SecurityModule } from '../security/security.module.js';
import { AccountService } from './account.service.js';
import { AuthEmails } from './auth-emails.js';
import { EmailGate } from './email-gate.js';
import { EmailTokensService } from './email-tokens.service.js';
import { LoginService } from './login.service.js';
import { MeController } from './me.controller.js';
import { PasswordResetController } from './password-reset.controller.js';
import { PasswordResetService } from './password-reset.service.js';
import { SessionController } from './session.controller.js';
import { SessionGuard } from './session.guard.js';
import { SessionsService } from './sessions.service.js';
import { SignupController } from './signup.controller.js';
import { SignupService } from './signup.service.js';

/** Accounts and sessions (spec §5 Auth, §6.1–§6.6). */
@Module({
  imports: [RateLimitModule, SecurityModule, EmailModule],
  controllers: [SessionController, MeController, SignupController, PasswordResetController],
  providers: [
    SessionsService,
    SessionGuard,
    EmailTokensService,
    EmailGate,
    AuthEmails,
    SignupService,
    LoginService,
    PasswordResetService,
    AccountService,
  ],
})
export class AuthModule {}
```

Run: `pnpm --filter @wishlist/api exec vitest run --project integration test/account.int-spec.ts test/sessions.int-spec.ts`
Expected: PASS, 17 tests: 9 here plus the 8 session tests.

- [ ] **Step 4: Gate, commit and submit**

```bash
API_ORIGIN=http://localhost:3001 pnpm turbo run lint typecheck test build
pnpm turbo run test:integration --filter=@wishlist/api
pnpm format:check
git add apps/api
git commit -F - <<'EOF'
feat(api): add display-name, password change and account deletion

Changing the password keeps the current session and revokes the rest;
deleting the account cascades to everything it owns and clears the
cookie (spec §5, §6.1). Both re-check the password, with 403 when it's
wrong, and the attempts count against login's per-address limit.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
gh stack submit --open
```

---

### Task 11: The daily cleanup cron

**Files:**
- Create in `apps/api/src/ops/`: `cleanup.service.ts`, `cron.controller.ts`, `ops.module.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/vercel.json`
- Test: `apps/api/test/cron.int-spec.ts`

**Interfaces:**
- **Consumes:**
  - From Task 2: all four auth tables and `rateLimits`.
  - From Task 3: `Env.CRON_SECRET` and `unauthenticated()`.
  - From Task 1: `CleanupResult`.
  - From Tasks 7 and 8: the `signUp`, `signUpVerified` and `logIn` helpers.
- **Produces:**
  - `CleanupService.runDaily(): Promise<CleanupResult>`.
  - `GET /api/internal/cron/daily`, which requires `Authorization: Bearer $CRON_SECRET`.
  - A Vercel cron entry, `0 9 * * *`.

- [ ] **Step 1: Add the stack layer**

```bash
gh stack add api/daily-cron
```

- [ ] **Step 2: Write the failing tests**

`apps/api/test/cron.int-spec.ts`:
```ts
import { CleanupResultSchema } from '@wishlist/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { http } from '../src/testing/app.js';
import { ADA, logIn, signUp, signUpVerified, type Account } from './support/accounts.js';
import { createAuthTestApp, type AuthTestApp } from './support/auth-app.js';
import { client } from './support/client.js';
import { openTestDatabase } from './support/database.js';

const SECRET = 'c'.repeat(48);
const BOB: Account = { email: 'bob@example.com', password: 'another fine passphrase', displayName: 'Bob' };
const DAY = 24 * 60 * 60 * 1000;

const db = openTestDatabase();
let t: AuthTestApp;
let unconfigured: AuthTestApp;

beforeAll(async () => {
  t = await createAuthTestApp(db.url, { CRON_SECRET: SECRET });
  unconfigured = await createAuthTestApp(db.url);
});

afterAll(async () => {
  await t.app.close();
  await unconfigured.app.close();
  await db.close();
});

beforeEach(async () => {
  await db.truncateAll();
  t.reset();
});

const runCron = (app: AuthTestApp['app'], authorization?: string) => {
  const req = http(app).get('/api/internal/cron/daily');
  return authorization ? req.set('Authorization', authorization) : req;
};
const count = async (table: string) =>
  Number((await db.pool.query<{ n: string }>(`select count(*) as n from ${table}`)).rows[0]?.n);

describe('GET /api/internal/cron/daily (spec §10)', () => {
  it('refuses requests without the exact bearer secret', async () => {
    for (const authorization of [undefined, 'Bearer wrong', `Bearer ${SECRET}x`, SECRET]) {
      expect((await runCron(t.app, authorization)).status).toBe(401);
    }
  });

  it('refuses everyone when CRON_SECRET is unset', async () => {
    for (const authorization of ['Bearer undefined', `Bearer ${SECRET}`]) {
      expect((await runCron(unconfigured.app, authorization)).status).toBe(401);
    }
  });

  it('purges week-old unverified accounts, expired tokens and sessions, and stale rate-limit windows', async () => {
    await signUp(t, ADA); // stays unverified
    await signUpVerified(t, BOB);
    await logIn(t, BOB);

    t.clock.advance(31 * DAY);
    const res = await runCron(t.app, `Bearer ${SECRET}`);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const result = CleanupResultSchema.parse(res.body);
    // Ada's account goes, and its token and wishlist cascade with it. Bob's used verification
    // token and his 30-day session have expired.
    expect(result).toMatchObject({ unverifiedUsers: 1, emailTokens: 1, sessions: 1 });
    expect(result.rateLimitWindows).toBeGreaterThan(0);

    const { rows } = await db.pool.query<{ email: string }>('select email from users');
    expect(rows.map((r) => r.email)).toEqual([BOB.email]);
    expect(await count('wishlists')).toBe(1);
    for (const table of ['sessions', 'email_tokens', 'rate_limits']) expect(await count(table)).toBe(0);
  });

  it('keeps unverified accounts younger than 7 days, and live sessions', async () => {
    await signUp(t, ADA);
    await signUpVerified(t, BOB);
    const bob = await logIn(t, BOB);

    t.clock.advance(6 * DAY);
    const result = CleanupResultSchema.parse((await runCron(t.app, `Bearer ${SECRET}`)).body);

    expect(result).toMatchObject({ unverifiedUsers: 0, sessions: 0 });
    expect(await count('users')).toBe(2);
    expect((await client(t.app, bob).get('/me')).status).toBe(200);
  });
});
```

Run: `pnpm --filter @wishlist/api exec vitest run --project integration test/cron.int-spec.ts`
Expected: FAIL. The route answers 404: the 401 expectations fail, and so does the purge test.

- [ ] **Step 3: Implement the cleanup, its endpoint, and the schedule**

`apps/api/src/ops/cleanup.service.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { CleanupResult } from '@wishlist/contracts';
import { and, isNull, lt } from 'drizzle-orm';
import { CLOCK, type Clock } from '../core/clock.js';
import { DB, type Database } from '../db/database.module.js';
import { emailTokens, rateLimits, sessions, users } from '../db/schema.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The daily purge (spec §6.5, §10 "Monitoring and maintenance"). */
@Injectable()
export class CleanupService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async runDaily(): Promise<CleanupResult> {
    const now = this.clock.now();
    // Unverified accounts first. Deleting one cascades to its wishlist, tokens and sessions. After a
    // week, a squatted, never-verified address mustn't keep blocking a real signup (spec §6.5).
    const unverified = await this.db
      .delete(users)
      .where(and(isNull(users.emailVerifiedAt), lt(users.createdAt, new Date(now.getTime() - 7 * DAY_MS))));
    const tokens = await this.db.delete(emailTokens).where(lt(emailTokens.expiresAt, now));
    const expired = await this.db.delete(sessions).where(lt(sessions.expiresAt, now));
    // The longest rate-limit window is an hour, so a window that started a day ago counts nothing.
    const windows = await this.db
      .delete(rateLimits)
      .where(lt(rateLimits.windowStart, new Date(now.getTime() - DAY_MS)));
    return {
      unverifiedUsers: unverified.rowCount ?? 0,
      emailTokens: tokens.rowCount ?? 0,
      sessions: expired.rowCount ?? 0,
      rateLimitWindows: windows.rowCount ?? 0,
    };
  }
}
```

`apps/api/src/ops/cron.controller.ts`:
```ts
import { createHash, timingSafeEqual } from 'node:crypto';
import { Controller, Get, Header, Inject, Req } from '@nestjs/common';
import type { CleanupResult } from '@wishlist/contracts';
import type { Request } from 'express';
import { ENV, type Env } from '../core/env.js';
import { unauthenticated } from '../http/errors.js';
import { CleanupService } from './cleanup.service.js';

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

@Controller('internal/cron')
export class CronController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(CleanupService) private readonly cleanup: CleanupService,
  ) {}

  /** Vercel Cron calls this daily (apps/api/vercel.json) with `Authorization: Bearer $CRON_SECRET`. */
  @Get('daily')
  @Header('Cache-Control', 'no-store')
  async daily(@Req() req: Request): Promise<CleanupResult> {
    if (!this.fromVercelCron(req.headers.authorization)) throw unauthenticated();
    return this.cleanup.runDaily();
  }

  private fromVercelCron(authorization: string | undefined): boolean {
    const secret = this.env.CRON_SECRET;
    if (!secret || !authorization) return false;
    // Compare fixed-length digests, so the check takes the same time however much matches.
    return timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`));
  }
}
```

`apps/api/src/ops/ops.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { CleanupService } from './cleanup.service.js';
import { CronController } from './cron.controller.js';

/** Scheduled maintenance (spec §10). */
@Module({ controllers: [CronController], providers: [CleanupService] })
export class OpsModule {}
```

Replace `apps/api/src/app.module.ts` with:
```ts
import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { CoreModule } from './core/core.module.js';
import { DatabaseModule } from './db/database.module.js';
import { HealthModule } from './health/health.module.js';
import { HttpSecurityModule } from './http/http-security.module.js';
import { OpsModule } from './ops/ops.module.js';

@Module({
  imports: [CoreModule, DatabaseModule, HttpSecurityModule, HealthModule, AuthModule, OpsModule],
})
export class AppModule {}
```

Replace `apps/api/vercel.json` with the following. Hobby runs a daily cron once a day, at some point within the hour you schedule:
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "git": { "deploymentEnabled": false },
  "installCommand": "pnpm install --frozen-lockfile && pnpm --filter @wishlist/contracts build",
  "crons": [{ "path": "/api/internal/cron/daily", "schedule": "0 9 * * *" }]
}
```

Run: `pnpm --filter @wishlist/api exec vitest run --project integration test/cron.int-spec.ts`
Expected: PASS, 4 tests.

- [ ] **Step 4: Gate, commit and submit, then check the cron reaches the build output**

```bash
API_ORIGIN=http://localhost:3001 pnpm turbo run lint typecheck test build
pnpm turbo run test:integration --filter=@wishlist/api
pnpm format:check
git add apps/api
git commit -F - <<'EOF'
feat(api): add the daily cleanup cron

Vercel Cron calls /api/internal/cron/daily with CRON_SECRET as a bearer
token. It purges unverified accounts older than 7 days, expired email
tokens and sessions, and stale rate-limit windows (spec §6.5, §10).
Without CRON_SECRET it refuses everyone.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
gh stack submit --open
```

After the PR's preview finishes, confirm that `vercel build` carried the cron into the build output. Vercel only runs crons for production deployments, but the definition travels in `config.json`:
```bash
RID=$(gh run list --workflow preview.yml --branch api/daily-cron --limit 1 --json databaseId --jq '.[0].databaseId')
D=$(mktemp -d) && gh run download "$RID" -n api-output -D "$D" && tar -xzf "$D/api-output.tgz" -C "$D"
jq '.crons' "$D/config.json"
rm -rf "$D"
```
Expected: `[{"path":"/api/internal/cron/daily","schedule":"0 9 * * *"}]`.

---

### Task 12: Preview wiring, docs and the spec

**Files:**
- Modify: `.github/workflows/preview.yml`, `apps/api/.env.example`
- Modify: `docs/deployment.md`, `docs/development.md`, `docs/superpowers/specs/2026-10-07-wishlist-app-design.md`, `docs/superpowers/plans/2026-10-07-roadmap.md`

**Interfaces:**
- **Consumes:** everything above.
- **Produces:**
  - API previews that accept Turnstile's always-pass test tokens.
  - Docs for the new variables, Mailpit and the cron.
  - The spec amendments for rulings 1, 2, 3, 5 and 8.
  - Roadmap rows 2a and 2b.

- [ ] **Step 1: Add the stack layer**

```bash
gh stack add docs/auth-api
```

- [ ] **Step 2: Let API previews use Turnstile's test secret**

Cloudflare publishes test keys. The secret `1x0000000000000000000000000000000AA` accepts any token, including the dummy token from the test site key Plan 2b's preview widget will use. It's a public value, not a credential, so it lives in the workflow and not in secrets. Previews never send email anyway.

```bash
python3 - <<'PY'
from pathlib import Path
p = Path('.github/workflows/preview.yml')
s = p.read_text()
comment = "          # EMAIL_TRANSPORT=log: a preview never emails anyone, whatever data it holds (spec §10).\n"
env_line = "            --env EMAIL_TRANSPORT=log \\\n"
assert s.count(comment) == 1 and s.count(env_line) == 1
s = s.replace(comment, comment + "          # Cloudflare's published always-pass test secret (public, not a credential): previews\n"
                                 "          # accept Turnstile test tokens, and their email is log-only anyway.\n")
s = s.replace(env_line, env_line + "            --env TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA \\\n")
p.write_text(s)
PY
node scripts/workflow-policy.test.mjs && node scripts/workflow-policy.mutations.test.mjs
docker run --rm -v "$PWD:/repo" --workdir /repo rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667 -color
```

Expected: `workflow-policy: ok`, `workflow-policy mutations: ok (15 caught)`, and no output from actionlint.

Append to `apps/api/.env.example`:
```
# Cloudflare's always-pass test secret. Pair it with the test site key in the web app (Plan 2b).
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
```

- [ ] **Step 3: Document the variables, the cron and Mailpit**

In `docs/deployment.md`, replace the whole `## Environment variables` section, from its heading up to `## GitHub configuration`, with this text. Save it as `env-section.md` in the scratch directory:
````markdown
## Environment variables

| Where | Name | Value |
| --- | --- | --- |
| Vercel `wishlist-api` → Production | `DATABASE_URL` (sensitive) | Neon pooled string |
| Vercel `wishlist-api` → Production | `APP_ORIGIN` | Web production origin. The CSRF guard compares it exactly, and email links use it |
| Vercel `wishlist-api` → Production | `CRON_SECRET` (sensitive) | 48 random bytes, base64. Vercel Cron sends it as a bearer token. Unset means the cron refuses everyone |
| Vercel `wishlist-api` → Production | `TURNSTILE_SECRET_KEY` (sensitive) | **Plan 2b.** While unset, signup, resend-verification and reset-request answer `503 CAPTCHA_UNAVAILABLE`. That's how Plan 2a ships dark |
| Vercel `wishlist-api` → Production | `EMAIL_TRANSPORT`, `EMAIL_FROM`, `RESEND_API_KEY` (sensitive) | **Plan 2b.** Until then `EMAIL_TRANSPORT` defaults to `log` |
| Set per preview by CI | `DATABASE_URL`, `APP_ORIGIN`, `EMAIL_TRANSPORT=log`, `TURNSTILE_SECRET_KEY` (Cloudflare's always-pass test secret), `GIT_SHA` | See `.github/workflows/preview.yml` |
| Set per deploy by CI | `GIT_SHA` | The commit being deployed |
| Set at build by CI | `API_ORIGIN` (web) | API production origin, or the PR's API preview URL |

Set a sensitive production variable without it touching disk or shell history. For example, `CRON_SECRET`:

```bash
openssl rand -base64 48 | tr -d '\n' \
  | npx --yes vercel@62.5.0 env add CRON_SECRET production --sensitive --project wishlist-api --scope shockolate
```

Runtime variables apply to the **next** deployment. Redeploy, or merge to `main`, after changing one.

## Daily cron

`apps/api/vercel.json` schedules `GET /api/internal/cron/daily` for 09:00 UTC. Hobby runs it once a day, at some point within that hour, and only on production deployments. Each run purges:
- unverified accounts older than 7 days, which cascades to their wishlists, tokens and sessions;
- expired email tokens and sessions;
- rate-limit windows older than a day.

The response lists the counts.

- **Check it ran:** Vercel → `wishlist-api` → Settings → Cron Jobs shows the schedule and has a **Run** button. The run's logs show the JSON counts.
- **It refuses** any request without `Authorization: Bearer $CRON_SECRET` with a `401`.

````

Splice it in, format it, and check the headings:
```bash
python3 - "$SCRATCH/env-section.md" <<'PY'
import sys
from pathlib import Path
p = Path('docs/deployment.md')
s = p.read_text()
start = s.index('## Environment variables\n')
end = s.index('## GitHub configuration\n')
p.write_text(s[:start] + Path(sys.argv[1]).read_text() + s[end:])
PY
pnpm exec prettier --write docs/deployment.md
grep -nE '^## (Environment variables|Daily cron|GitHub configuration)' docs/deployment.md
```
(`$SCRATCH` is the executor's scratch directory.)

Expected: three headings, in this order: `Environment variables`, `Daily cron`, `GitHub configuration`.

In `docs/development.md`, apply three edits:

1. **First-time setup.** After the line `cp apps/api/.env.example apps/api/.env`, add this paragraph below the code block:
   ```markdown
   Already have an `apps/api/.env`? Since Plan 2a the API needs `APP_ORIGIN`, and local development uses `EMAIL_TRANSPORT=mailpit` and Turnstile's test secret. Copy the new lines from `.env.example`, or the API stops at boot and names the missing variable.
   ```
2. **Services table.** Add a row: `| Mailpit (email inbox) | http://localhost:8025 |`.
3. **A new section.** Add this after `## Database`:
   ````markdown
   ## Trying the auth API

   The API sends email to Mailpit, so every link lands in the inbox at http://localhost:8025. Turnstile's test secret accepts any token. State-changing requests must carry the web origin and a JSON body; the CSRF guard rejects anything else.

   ```bash
   API=http://localhost:3001/api; ORIGIN=http://localhost:3000
   curl -i -X POST "$API/auth/signup" -H "Origin: $ORIGIN" -H 'content-type: application/json' \
     -d '{"email":"ada@example.com","password":"correct horse battery 1","displayName":"Ada","turnstileToken":"x"}'
   # Open the email in Mailpit, copy the token from the link, then:
   curl -i -X POST "$API/auth/verify-email" -H "Origin: $ORIGIN" -H 'content-type: application/json' -d '{"token":"<token>"}'
   curl -i -c /tmp/jar -X POST "$API/auth/login" -H "Origin: $ORIGIN" -H 'content-type: application/json' \
     -d '{"email":"ada@example.com","password":"correct horse battery 1"}'
   curl -i -b /tmp/jar "$API/me"
   ```

   curl keeps the `__Host-session` cookie over plain http because it's localhost.
   ````

- [ ] **Step 4: Amend the spec and the roadmap**

```bash
python3 - <<'PY'
from pathlib import Path
p = Path('docs/superpowers/specs/2026-10-07-wishlist-app-design.md')
s = p.read_text()
def swap(old, new):
    global s
    assert s.count(old) == 1, old[:70]
    s = s.replace(old, new)

swap("For validation failures they also include `errors[]`, the path of each bad field.",
     "For validation failures they also include `errors[]`, the path of each bad field; those are `400 VALIDATION_FAILED` (Plan 2a).")
swap("| `POST /me/password` | `{currentPassword, newPassword}` | `204`. Revokes all **other** sessions |",
     "| `POST /me/password` | `{currentPassword, newPassword}` | `204`. Revokes all **other** sessions. A wrong current password is `403 INVALID_CREDENTIALS`: a `401` would read as \"signed out\" |")
swap("| `DELETE /me` | `{password}` | `204`. Cascades everything and clears the cookie |",
     "| `DELETE /me` | `{password}` | `204`. Cascades everything and clears the cookie. A wrong password is `403 INVALID_CREDENTIALS` |")
swap("**Client IP (resolved by",
     "**Buckets and order (Plan 2a).** Signup, resend-verification and reset-request share one per-address and one per-IP bucket: together they cap the mail one inbox or one IP can trigger. Those endpoints check the per-IP limit, then Turnstile, then the per-address limit, so failed challenges can't use up a victim's budget. Password confirmations on `/me` count against login's per-address bucket. Keys store a SHA-256 of the email or IP, never the raw value.\n\n**Client IP (resolved by")
swap("| Resend | The endpoint still returns `202`. The error goes to Sentry, and the user can resend |",
     "| Resend | The endpoint still returns `202`: email is delivered in the background, after the response (Plan 2a). The error is logged (Sentry from Plan 5), and the user can resend |")
swap("`EMAIL_TRANSPORT` (`resend` or `log`)",
     "`EMAIL_TRANSPORT` (`resend`, `mailpit` for local development and E2E, or `log`), `EMAIL_FROM`")
p.write_text(s)

r = Path('docs/superpowers/plans/2026-10-07-roadmap.md')
t = r.read_text()
row2 = t[t.index("| 2 | Accounts & auth |"):]
row2 = row2[:row2.index("\n")]
assert t.count(row2) == 1
t = t.replace(row2,
    "| 2a | [Auth API](2026-10-09-plan-2a-auth-api.md) | §2 Actors, §4, §5 Auth, §6.1–6.6, §8, §9, §10 cron | Users, sessions, email-token and wishlist tables; argon2id; Turnstile and HIBP ports; email via log, Mailpit or Resend; validation pipe, CSRF guard and rate limits; signup, verify, resend, login, logout, reset, `/me`, password change, account deletion; daily cleanup cron. Ships dark | Done |\n"
    "| 2b | Auth web & go-live | §6.7, §6.9, §7 auth routes, §10 Domain and DNS | Domain and DNS; Resend and Turnstile in production; auth pages, request proxy, CSP with nonces, Turnstile widget; the account parts of `/settings`; Mailpit-backed E2E golden path | Not started |")
r.write_text(t)
PY
grep -n "Plan 2a" docs/superpowers/specs/2026-10-07-wishlist-app-design.md | cut -c1-90
grep -nE "^\| 2[ab] " docs/superpowers/plans/2026-10-07-roadmap.md | cut -c1-60
```

Expected: five lines that mention Plan 2a, and the two roadmap rows.

- [ ] **Step 5: Gate, commit and submit**

```bash
pnpm format:check
git add .github/workflows/preview.yml apps/api/.env.example docs
git commit -F - <<'EOF'
docs: document the auth API, its variables and cron; preview Turnstile

API previews get Cloudflare's always-pass Turnstile test secret (a public
value), so Plan 2b's preview widget works; previews never send email.
The deployment guide covers the new variables and the daily cron, the
development guide covers Mailpit and trying the API with curl, and the
spec records this plan's rulings.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
gh stack submit --open
```

Expected: all checks pass on every `auth-api-2` PR.

---

### Task 13: ⏸ Exercise a preview, merge stack 2, verify production

**Files:** none (operations).

- [ ] **Step 1: Exercise the stack's top preview end to end**

The API preview is public, and its email goes to Vercel's logs. Reading those logs uses Ted's local Vercel login. This run proves several things on real infrastructure: the argon2 native binary in Vercel's runtime, the `__Host-` cookie over https, the CSRF guard with the alias as `Origin`, and the log transport.

```bash
PR=$(gh pr list --head docs/auth-api --json number --jq '.[0].number')
RID=$(gh run list --workflow preview.yml --branch docs/auth-api --limit 1 --json databaseId --jq '.[0].databaseId')
API=$(gh run view "$RID" --log | grep -oE 'API_URL: https://[^ ]+' | head -1 | cut -d' ' -f2)
ORIGIN="https://$(gh variable get PREVIEW_ALIAS_PREFIX)$PR.vercel.app"
EMAIL="preview-probe-$(date +%s)@example.com"
JSON=(-H "Origin: $ORIGIN" -H 'content-type: application/json')

curl -s -o /dev/null -w '%{http_code}\n' -X POST "$API/api/auth/signup" "${JSON[@]}" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"preview probe passphrase 1\",\"displayName\":\"Probe\",\"turnstileToken\":\"XXXX.DUMMY.TOKEN.XXXX\"}"
sleep 5
TOKEN=$(pnpm exec vercel logs "$API" 2>/dev/null | grep -oE 'verify-email\?token=[A-Za-z0-9_-]{43}' | tail -1 | cut -d= -f2)
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$API/api/auth/verify-email" "${JSON[@]}" -d "{\"token\":\"$TOKEN\"}"
JAR=$(mktemp)
curl -s -o /dev/null -w '%{http_code}\n' -c "$JAR" -X POST "$API/api/auth/login" "${JSON[@]}" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"preview probe passphrase 1\"}"
curl -s -b "$JAR" "$API/api/me"; echo
rm -f "$JAR"
```

Expected:
- `202`, then `204`, then `204`.
- `/api/me` answers `{"id":"…","email":"preview-probe-…@example.com","displayName":"Probe","emailVerified":true}`.

If `vercel logs` shows nothing yet, wait a few seconds and try again; it streams with a delay. The probe account lives only in `pr-<n>`, which cleanup deletes when the PR closes.

- [ ] **Step 2: ⏸ CHECKPOINT — Ted sets `CRON_SECRET` in production**

```bash
openssl rand -base64 48 | tr -d '\n' \
  | npx --yes vercel@62.5.0 env add CRON_SECRET production --sensitive --project wishlist-api --scope shockolate
```

Nobody needs to read the secret back: Vercel sends it on cron calls, and the dashboard's **Run** button uses it. Leave `TURNSTILE_SECRET_KEY` and the email variables unset until Plan 2b.

- [ ] **Step 3: ⏸ CHECKPOINT — Ted reviews and merges `auth-api-2`**

```bash
gh stack merge <top-pr> --squash --yes
gh stack sync --prune && git switch main && git pull --ff-only
```

- [ ] **Step 4: Verify production**

```bash
RID=$(gh run list --workflow deploy.yml --commit "$(git rev-parse HEAD)" --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RID" --interval 15 --exit-status
APP=$(gh variable get APP_PRODUCTION_ORIGIN)
API=$(gh variable get API_PRODUCTION_ORIGIN)
curl -fsS "$APP/api/health"; echo
curl -s -o /dev/null -w 'me: %{http_code}\n' "$APP/api/me"
curl -s -X POST "$APP/api/auth/signup" -H "Origin: $APP" -H 'content-type: application/json' \
  -d '{"email":"probe@example.com","password":"production probe passphrase","displayName":"Probe","turnstileToken":"x"}' | jq -r .code
curl -s -o /dev/null -w 'cron without the secret: %{http_code}\n' "$API/api/internal/cron/daily"
```

Expected:
- **The deploy:** all seven jobs pass. Its smoke tests include `/api/me` answering 401.
- **Health:** reports the merge commit.
- **The probes:** `me: 401`, then `CAPTCHA_UNAVAILABLE`, which proves 2a is dark, then `cron without the secret: 401`.

Then ⏸ **Ted** opens Vercel → `wishlist-api` → Settings → Cron Jobs. He confirms `/api/internal/cron/daily` is listed, presses **Run**, and checks the run's log line shows the JSON counts.
