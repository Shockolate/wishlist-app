# Plan 5b — Errors & readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every unexpected failure in Hanker reaches Ted through Sentry, with a readable stack trace and nothing that leaks a capability token or personal data. A written operations checklist keeps the site's recurring chores, the quarterly restore drill among them, from depending on memory.

**Architecture:**
- **One scrubber, defined once.** `redactTokens` and `redactDeep` in `packages/contracts` replace capability tokens, email tokens and email addresses in any string, at any depth. Each app's `scrubEvent` deletes the request parts and the user, then runs `redactDeep` over the event. It's the SDK's `beforeSend`.
- **API (`api/sentry`).** An `ErrorReporter` port, provided globally by `CoreModule`: `SentryErrorReporter` (`@sentry/node`) when `SENTRY_DSN` is set, otherwise a no-op. It's called from the five places that already log a problem. A `DrizzleQueryError` is rebuilt without its bound parameters before it's reported. Node translates stack traces through the source maps Vercel already deploys.
- **Web (`web/sentry`).** `@sentry/node` in `instrumentation.ts` (`onRequestError`) and `@sentry/browser` in `instrumentation-client.ts`. `error.tsx` reports client-side errors. The DSN is inlined at build from `SENTRY_DSN_WEB`, which only `deploy.yml` reads, and the CSP's `connect-src` gains exactly the DSN's origin.
- **Browser source maps (`ops/sourcemaps`).** The production build emits them. The build job, which holds no secrets, writes debug IDs into them and moves them out of the deploy output into a `web-sourcemaps` artifact. A `sourcemaps` job holding `SENTRY_AUTH_TOKEN` uploads them with a checksum-pinned `sentry-cli`. `check-vercel-output.sh` refuses any `.map` under `static/`.
- **Tests (`test/deterministic-locks`).** Four lock-holder tests swap their 300 ms sleep for a wait on `pg_stat_activity`. One of them also starts its request, which it never actually did.
- **Docs (`docs/operations`).** `docs/operations.md`, and Plan 5a's minors M1–M4.

**Tech Stack:** `@sentry/node` 11.8.0, `@sentry/browser` 11.8.0, `@vercel/functions` 3.9.11 (new in `apps/web`), `sentry-cli` 3.8.0 (standalone binary), NestJS 12, Next.js 16, Zod 4, Vitest, Playwright, GitHub Actions, Bash.

**Spec:** [docs/superpowers/specs/2026-10-07-wishlist-app-design.md](../specs/2026-10-07-wishlist-app-design.md): §6.7 (Sentry), §6.9 (`connect-src`), §9 (unexpected errors, Resend), §10 Workflows (`deploy.yml`), Monitoring ("Errors", "Operations checklist"), Recovery (D53), Secrets; decisions D50–D53. It was amended for this plan in `3d89ca6`. Also [the CI isolation addendum](../specs/2026-10-08-ci-secret-isolation-and-seeded-previews-design.md) §2, whose trust model the `sourcemaps` job lives under.

## Global Constraints

**Carried over from earlier plans.** Everything from Plans 1–5a still applies; [AGENTS.md](../../../AGENTS.md) summarizes it:
- Node `>=24.15`, pnpm `12.10.1`, ESM, TypeScript `6.0.3`, ESLint `9.39.5`. Relative imports in `api`, `contracts` and `e2e` end in `.js`; the web app uses bundler resolution and the `@/` alias.
- Exact version pins. **New direct dependencies, and no others:** `@sentry/node` `11.8.0` in `apps/api` and `apps/web`; `@sentry/browser` `11.8.0` and `@vercel/functions` `3.9.11` in `apps/web`.
- Explicit `@Inject(…)` on every Nest constructor parameter.
- Behavior changes are written test-first. Web unit tests run in Node with no DOM, so logic worth testing lives in pure modules under `apps/web/src/lib`.
- Touching `.github/workflows/` or `scripts/` means running both policy tests, the changed script's `*.test.sh`, and actionlint (the pinned command is in `.github/workflows/ci.yml`). A new script gets a `*.test.sh`, listed in CI's "Script tests".
- Every commit ends with a `Co-Authored-By:` trailer naming the model that actually wrote it: replace `<the model that wrote this commit>` below.

**What Sentry may receive (spec §6.7, D50).**
- **Never:** a capability token, an email token, an email address, a password, a cookie, a request header or body, or a stack frame's local variables.
- **SDK settings that enforce it.** `@sentry/node` and `@sentry/browser` v11 replaced `sendDefaultPii` with `dataCollection`, whose defaults **collect** cookies, headers, bodies and stack-frame variables. Every `init` therefore passes the `DATA_COLLECTION_OFF` object from the tasks below, and `defaultIntegrations: false`. On Node it also passes `includeLocalVariables: false` and `enableRuntimeChannelInjection: false`, so no module is instrumented at load.
- **No tracing and no replay:** no `tracesSampleRate`, no replay integration.
- **Production only.** No DSN in previews, CI, E2E or local development, and the policy test keeps it that way.

**Pins, verified 2026-10-19:**
- `@sentry/node` and `@sentry/browser` `11.8.0` (released 2026-10-15). The `init` options and integrations used below were compiled against these exact versions with `tsc --strict`.
- `sentry-cli` `3.8.0` (released 2026-09-16), asset `sentry-cli-Linux-x86_64`, sha256 `13f8cb34ae01a6a272d7d7c22e277a105286615b4020de900ea95a8de47cdbb6`. It matches the digest GitHub publishes for the asset.
- `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`, `actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2`, `actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2`, as in the other workflows.

**Nothing in Tasks 1–10 creates a cloud resource or sets a secret or variable.** Task 11 lists Ted's steps.

## Review Focus

These are the failure modes most likely to hurt someone that the spec implies but no happy-path test would catch. Each one has a pinned test in the task named.

1. **A token or personal data reaches Sentry through a field nobody thought of.** v11's defaults collect cookies, headers, bodies and frame variables, and a scrubber that covers named fields misses new ones. Pinned in Task 2: the real `@sentry/node` client, through a fake transport, sends an event in which no token, email or local-variable value appears anywhere in the serialized JSON, with a token and an email in the message, the tags and the extras. Pinned in Task 4: the web's `scrubEvent` on a browser-shaped event.
2. **A failed query's parameters leak.** `DrizzleQueryError` puts every bound value in its message and stack. Pinned in Task 2: `reportable()` of one whose parameters include an email and a password hash yields an error containing neither.
3. **The error path breaks the error response.** A reporter that throws, say an SDK bug or a bad DSN, must not turn a 500 problem response into a crash or a hang. Pinned in Task 3: the filter, with a reporter that throws, still sends the `500` problem.
4. **Unreviewed code reports, or maps are served.** A preview build that inlines the DSN would send events from PR code, and maps on `hanker.dev` would be served to everyone. Pinned in Task 5: a policy rule and its mutation keep `SENTRY_DSN_WEB` out of every job but `deploy.yml#build`, and an E2E test proves a DSN-less build makes no request to any Sentry origin. Pinned in Task 6: `check-vercel-output.sh` refuses an output with a `.map` under `static/`.
5. **A Sentry problem blocks a release.** A missing token or a Sentry outage must not fail or hold up the deploy. Pinned in Task 7:
   - a policy rule and its mutation: no job `needs` `sourcemaps`;
   - the upload skips with a notice when `SENTRY_AUTH_TOKEN` is unset;
   - the extract script always produces an artifact, so the download can't fail.

---

## Layers

| Layer | Branch | Tasks |
|---|---|---|
| 1 | `docs/plan-5b` | The spec amendment (`3d89ca6`) and this plan |
| 2 | `contracts/redact-tokens` | Task 1 |
| 3 | `api/sentry` | Tasks 2, 3 |
| 4 | `web/sentry` | Tasks 4, 5 |
| 5 | `ops/sourcemaps` | Tasks 6, 7 |
| 6 | `test/deterministic-locks` | Task 8 |
| 7 | `docs/operations` | Tasks 9, 10 |

Task 11 is the go-live checkpoint after Ted merges the stack.

---

### Task 1: `redactTokens` and `redactDeep` in contracts

**Files:**
- Create: `packages/contracts/src/redact.ts`
- Create: `packages/contracts/src/redact.spec.ts`
- Modify: `packages/contracts/src/index.ts` (one export line)

**Interfaces:**
- Produces: `redactTokens(text: string): string` and `redactDeep<T>(value: T): T` from `@wishlist/contracts`. `redactDeep` returns a copy in which every string value, and every object key, has been through `redactTokens`. Tasks 2 and 4 build `scrubEvent` on it.

- [ ] **Step 1: Write the failing test**

Create `packages/contracts/src/redact.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { redactDeep, redactTokens } from './redact.js';

const CAPABILITY = 'AbCdEfGhIjKlMnOpQrStUv'; // 22 base64url characters
const EMAIL_TOKEN = 'a'.repeat(43);

describe('redactTokens', () => {
  it.each([
    ['a share page', `https://hanker.dev/s/${CAPABILITY}`, 'https://hanker.dev/s/[redacted]'],
    ['a manage page with a query', `/c/${CAPABILITY}?x=1`, '/c/[redacted]?x=1'],
    ['a shared API path', `/api/shared/${CAPABILITY}/items/3f1c`, '/api/shared/[redacted]/items/3f1c'],
    [
      'a ContractMismatchError message',
      `Response from /claims/${CAPABILITY} does not match its contract`,
      'Response from /claims/[redacted] does not match its contract',
    ],
    ['a token query parameter', '/verify-email?token=abc_DEF-123&next=/list', '/verify-email?token=[redacted]&next=/list'],
    ['an email token anywhere', `token ${EMAIL_TOKEN} used`, 'token [redacted] used'],
    ['an email address', 'mail to ada.lovelace+gifts@example.co.uk failed', 'mail to [email] failed'],
  ])('redacts %s', (_label, input, expected) => {
    expect(redactTokens(input)).toBe(expected);
  });

  it.each([
    ['a pnpm path that looks like an email', 'at /var/task/node_modules/.pnpm/@sentry+node@11.8.0/node_modules/@sentry/node/build/esm/index.js:3:9'],
    ['an ordinary stack frame', 'at ClaimsService.claim (/var/task/apps/api/src/claims/claims.service.js:42:11)'],
    ['an API route pattern', '/api/claims/:manageToken'],
    ['a web route pattern', '/c/[manageToken]'],
    ['a segment that is too long to be a token', `/c/${CAPABILITY}W`],
  ])('leaves %s alone', (_label, input) => {
    expect(redactTokens(input)).toBe(input);
  });
});

describe('redactDeep', () => {
  it('redacts strings and keys at any depth, and leaves other values as they are', () => {
    const input = {
      message: `GET /s/${CAPABILITY}`,
      count: 3,
      ok: true,
      nothing: null,
      list: [`/claims/${CAPABILITY}`, 7],
      nested: { [`ada@example.com`]: { deeper: `?token=${EMAIL_TOKEN}` } },
    };
    expect(redactDeep(input)).toEqual({
      message: 'GET /s/[redacted]',
      count: 3,
      ok: true,
      nothing: null,
      list: ['/claims/[redacted]', 7],
      nested: { '[email]': { deeper: '?token=[redacted]' } },
    });
  });

  it('copies rather than mutates, and survives a cycle', () => {
    const input: Record<string, unknown> = { path: `/c/${CAPABILITY}` };
    input.self = input;
    const output = redactDeep(input) as Record<string, unknown>;
    expect(input.path).toBe(`/c/${CAPABILITY}`);
    expect(output.path).toBe('/c/[redacted]');
    expect(output.self).toBe(output);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @wishlist/contracts test`
Expected: FAIL, `./redact.js` can't be resolved.

- [ ] **Step 3: Write the module**

Create `packages/contracts/src/redact.ts`:

```ts
/**
 * Redaction for anything that leaves the app for a third party, today Sentry (spec §6.7, D50).
 * The token shapes match CAPABILITY_TOKEN_PATTERN (claims.ts) and EmailTokenSchema (auth.ts).
 */

const REDACTED = '[redacted]';

/** A share or manage token where the app's URLs carry one: /s/, /c/, /shared/, /claims/. */
const PATH_TOKEN = /(\/(?:s|c|shared|claims)\/)[A-Za-z0-9_-]{22}(?![A-Za-z0-9_-])/g;
/** The verify and reset pages' ?token=… */
const QUERY_TOKEN = /([?&]token=)[^&#\s"'<>]+/gi;
/** An email token (32 random bytes, base64url) wherever it appears. */
const EMAIL_TOKEN = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g;
/**
 * An email address. The domain must end in letters, so pnpm's `@sentry+node@11.8.0/…` paths in
 * stack traces are left alone.
 */
const EMAIL =
  /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![A-Za-z0-9-])/g;

export function redactTokens(text: string): string {
  return text
    .replace(PATH_TOKEN, `$1${REDACTED}`)
    .replace(QUERY_TOKEN, `$1${REDACTED}`)
    .replace(EMAIL_TOKEN, REDACTED)
    .replace(EMAIL, '[email]');
}

/** A copy of `value` with every string, and every object key, passed through redactTokens. */
export function redactDeep<T>(value: T): T {
  return walk(value, new WeakMap()) as T;
}

function walk(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (typeof value === 'string') return redactTokens(value);
  if (value === null || typeof value !== 'object') return value;
  const known = seen.get(value);
  if (known !== undefined) return known;
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(walk(item, seen));
    return copy;
  }
  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  for (const [key, item] of Object.entries(value)) copy[redactTokens(key)] = walk(item, seen);
  return copy;
}
```

Append to `packages/contracts/src/index.ts`: `export * from './redact.js';`

- [ ] **Step 4: Run the tests and build**

Run: `pnpm --filter @wishlist/contracts test && pnpm --filter @wishlist/contracts build`
Expected: PASS (every `it.each` case), and the build succeeds.

- [ ] **Step 5: Run what CI runs, then commit**

Run: `pnpm format:check && API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build`
Expected: every task succeeds.

```bash
git add packages/contracts/src/redact.ts packages/contracts/src/redact.spec.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): add redactTokens and redactDeep for anything sent to a third party

Co-Authored-By: <the model that wrote this commit> <noreply@anthropic.com>"
```

---

### Task 2: The API's `ErrorReporter` and the Sentry adapter

**Files:**
- Create: `apps/api/src/observability/error-reporter.ts`
- Create: `apps/api/src/observability/scrub-event.ts`
- Create: `apps/api/src/observability/reportable.ts`
- Create: `apps/api/src/observability/sentry-error-reporter.ts`
- Create: `apps/api/src/observability/scrub-event.spec.ts`
- Create: `apps/api/src/observability/reportable.spec.ts`
- Create: `apps/api/src/observability/sentry-error-reporter.spec.ts`
- Modify: `apps/api/src/core/env.ts` (add `SENTRY_DSN`)
- Modify: `apps/api/src/core/core.module.ts` (provide `ERROR_REPORTER`)
- Modify: `apps/api/src/testing/fakes.ts` (add `FakeErrorReporter`)
- Modify: `apps/api/src/main.ts` (enable source maps)
- Modify: `apps/api/package.json` (add `"@sentry/node": "11.8.0"`)

**Interfaces:**
- Consumes: `redactDeep` (Task 1).
- Produces, from `apps/api/src/observability/error-reporter.ts`:
  - `interface ErrorContext { requestId?: string; route?: string }`;
  - `interface ErrorReporter { captureException(error: unknown, context?: ErrorContext): void; captureWarning(message: string, context?: ErrorContext): void }`;
  - `ERROR_REPORTER` (a symbol), and `NOOP_REPORTER: ErrorReporter`.
- Produces: `FakeErrorReporter` in `testing/fakes.ts`, with `exceptions: { error: unknown; context?: ErrorContext }[]` and `warnings: { message: string; context?: ErrorContext }[]`.
- Produces: `CoreModule` exports `ERROR_REPORTER` globally. Task 3 injects it.

- [ ] **Step 1: Add the dependency**

Run: `pnpm --filter @wishlist/api add @sentry/node@11.8.0 --save-exact`
Expected: `apps/api/package.json` gains `"@sentry/node": "11.8.0"`, and `pnpm-lock.yaml` is updated.

- [ ] **Step 2: Write the failing tests**

Create `apps/api/src/observability/scrub-event.spec.ts`:

```ts
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
    expect(scrubbed?.request).toEqual({ url: 'https://wishlist-api.vercel.app/api/claims/[redacted]' });
    expect(scrubbed?.tags).toEqual({ route: '/api/claims/:manageToken' });
  });
});
```

Create `apps/api/src/observability/reportable.spec.ts`:

```ts
import { DrizzleQueryError } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { reportable } from './reportable.js';

describe('reportable', () => {
  it('rebuilds a failed query without its bound parameters', () => {
    const driverError = new Error('duplicate key value violates unique constraint "users_email_unique"');
    const failure = new DrizzleQueryError(
      'insert into "users" ("email", "password_hash") values ($1, $2)',
      ['ada@example.com', '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA'],
      driverError,
    );
    const result = reportable(failure);
    expect(result).toBeInstanceOf(Error);
    const text = `${(result as Error).message}\n${(result as Error).stack ?? ''}`;
    expect(text).toContain('insert into "users"');
    expect(text).toContain('users_email_unique');
    expect(text).not.toContain('ada@example.com');
    expect(text).not.toContain('argon2id');
  });

  it('passes any other error through untouched', () => {
    const error = new TypeError('nope');
    expect(reportable(error)).toBe(error);
  });
});
```

Create `apps/api/src/observability/sentry-error-reporter.spec.ts`:

```ts
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
  envelopes.map((envelope) => (envelope as [unknown, [[unknown, Record<string, unknown>]]])[1][0][1]);

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
    reporter.captureWarning('captcha unavailable: siteverify answered HTTP 400', { requestId: 'req-2' });
    await reporter.flush();
    expect(sentEvents().at(-1)).toMatchObject({
      level: 'warning',
      message: 'captcha unavailable: siteverify answered HTTP 400',
      tags: { requestId: 'req-2' },
    });
  });
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `pnpm --filter @wishlist/api test -- observability`
Expected: FAIL, the three modules don't exist.

- [ ] **Step 4: Write the port, the scrubber and `reportable`**

Create `apps/api/src/observability/error-reporter.ts`:

```ts
/** What a report carries besides the error: never the raw URL, a body or a user (spec §6.7). */
export interface ErrorContext {
  requestId?: string;
  /** The route pattern, e.g. /api/claims/:manageToken. */
  route?: string;
}

/** Port for error reporting (spec §10 Monitoring, D50). Reporting never throws. */
export interface ErrorReporter {
  captureException(error: unknown, context?: ErrorContext): void;
  /** An operator-actionable condition that isn't an exception, e.g. Turnstile unavailable. */
  captureWarning(message: string, context?: ErrorContext): void;
}

export const ERROR_REPORTER = Symbol('ERROR_REPORTER');

/** Used when SENTRY_DSN is unset: previews, CI, tests and local development. */
export const NOOP_REPORTER: ErrorReporter = {
  captureException: () => undefined,
  captureWarning: () => undefined,
};
```

Create `apps/api/src/observability/scrub-event.ts`:

```ts
import type { ErrorEvent } from '@sentry/node';
import { redactDeep } from '@wishlist/contracts';

/**
 * Sentry's beforeSend (spec §6.7). The request keeps only its URL, the user goes, and every string
 * left is redacted, so a token or an address can't ride in on a field nobody listed.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent | null {
  const { user: _user, request, ...rest } = event;
  const kept: ErrorEvent = { ...rest };
  if (request?.url) kept.request = { url: request.url };
  return redactDeep(kept);
}
```

Create `apps/api/src/observability/reportable.ts`:

```ts
import { DrizzleQueryError } from 'drizzle-orm';

/**
 * The error to report in place of `error`. Drizzle puts every bound parameter (emails, password
 * hashes, display names) in a failed query's message and stack, so one is rebuilt from its
 * parameterized SQL and the driver's error, as ProblemDetailsFilter already logs it.
 */
export function reportable(error: unknown): unknown {
  if (!(error instanceof DrizzleQueryError)) return error;
  const cause = error.cause;
  const rebuilt = new Error(
    `Failed query: ${error.query}${cause instanceof Error ? `\n${cause.message}` : ''}`,
  );
  rebuilt.name = 'DrizzleQueryError';
  if (cause instanceof Error && cause.stack) {
    rebuilt.stack = `${rebuilt.name}: ${rebuilt.message}\n${cause.stack.split('\n').slice(1).join('\n')}`;
  }
  return rebuilt;
}
```

- [ ] **Step 5: Write the Sentry adapter**

Create `apps/api/src/observability/sentry-error-reporter.ts`:

```ts
import * as Sentry from '@sentry/node';
import { waitUntil } from '@vercel/functions';
import type { ErrorContext, ErrorReporter } from './error-reporter.js';
import { reportable } from './reportable.js';
import { scrubEvent } from './scrub-event.js';

/**
 * Everything the SDK would collect on its own, switched off (spec §6.7). v11's defaults collect
 * cookies, headers, bodies and stack-frame variables.
 */
export const DATA_COLLECTION_OFF = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
} satisfies Sentry.NodeOptions['dataCollection'];

export interface SentryReporterOptions {
  dsn: string;
  release: string;
  environment: string;
  /** Tests pass a fake; production uses the SDK's own. */
  transport?: Sentry.NodeOptions['transport'];
}

/**
 * Explicit capture only (D50): no auto-instrumentation, so nothing is recorded but what the app
 * reports, and every event passes scrubEvent. Captures are flushed with waitUntil, because Vercel
 * may freeze the function once the response is sent; elsewhere waitUntil does nothing.
 */
export class SentryErrorReporter implements ErrorReporter {
  constructor(options: SentryReporterOptions) {
    Sentry.init({
      dsn: options.dsn,
      release: options.release,
      environment: options.environment,
      defaultIntegrations: false,
      integrations: [
        Sentry.onUncaughtExceptionIntegration(),
        Sentry.onUnhandledRejectionIntegration(),
        Sentry.linkedErrorsIntegration(),
        Sentry.dedupeIntegration(),
      ],
      enableRuntimeChannelInjection: false,
      includeLocalVariables: false,
      dataCollection: DATA_COLLECTION_OFF,
      beforeSend: scrubEvent,
      ...(options.transport ? { transport: options.transport } : {}),
    });
  }

  captureException(error: unknown, context: ErrorContext = {}): void {
    this.report(context, () => Sentry.captureException(reportable(error)));
  }

  captureWarning(message: string, context: ErrorContext = {}): void {
    this.report(context, () => Sentry.captureMessage(message, 'warning'));
  }

  flush(): Promise<boolean> {
    return Sentry.flush(2_000);
  }

  close(): Promise<boolean> {
    return Sentry.close(2_000);
  }

  private report(context: ErrorContext, capture: () => void): void {
    try {
      Sentry.withScope((scope) => {
        if (context.requestId) scope.setTag('requestId', context.requestId);
        if (context.route) scope.setTransactionName(context.route);
        capture();
      });
      waitUntil(this.flush());
    } catch {
      // Reporting must never take the error path down with it.
    }
  }
}
```

- [ ] **Step 6: Run the observability tests**

Run: `pnpm --filter @wishlist/api test -- observability`
Expected: PASS: scrub-event 1, reportable 2, sentry-error-reporter 2.

- [ ] **Step 7: Wire it in**

In `apps/api/src/core/env.ts`, add to the `z.object({ … })` after `CRON_SECRET`:

```ts
    /** The API's Sentry project. Set only in production (spec §10); unset means no reporting. */
    SENTRY_DSN: z.url().optional(),
```

Replace `apps/api/src/core/core.module.ts` with:

```ts
import { Global, Module } from '@nestjs/common';
import { ERROR_REPORTER, NOOP_REPORTER, type ErrorReporter } from '../observability/error-reporter.js';
import { SentryErrorReporter } from '../observability/sentry-error-reporter.js';
import { CLOCK, systemClock } from './clock.js';
import { ENV, parseEnv, type Env } from './env.js';

@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: (): Env => parseEnv(process.env) },
    { provide: CLOCK, useValue: systemClock },
    {
      provide: ERROR_REPORTER,
      inject: [ENV],
      useFactory: (env: Env): ErrorReporter =>
        env.SENTRY_DSN
          ? new SentryErrorReporter({
              dsn: env.SENTRY_DSN,
              release: env.GIT_SHA,
              environment: env.VERCEL_ENV ?? env.NODE_ENV,
            })
          : NOOP_REPORTER,
    },
  ],
  exports: [ENV, CLOCK, ERROR_REPORTER],
})
export class CoreModule {}
```

Append to `apps/api/src/testing/fakes.ts` (add `import type { ErrorContext, ErrorReporter } from '../observability/error-reporter.js';` to its imports):

```ts
/** Error-reporting stand-in. Records every report. */
export class FakeErrorReporter implements ErrorReporter {
  readonly exceptions: { error: unknown; context?: ErrorContext }[] = [];
  readonly warnings: { message: string; context?: ErrorContext }[] = [];

  captureException(error: unknown, context?: ErrorContext): void {
    this.exceptions.push({ error, context });
  }

  captureWarning(message: string, context?: ErrorContext): void {
    this.warnings.push({ message, context });
  }
}
```

In `apps/api/src/main.ts`, insert as the first line, before `import './load-env.js';`:

```ts
// Vercel deploys a source map beside each compiled file: report TypeScript lines (D52).
process.setSourceMapsEnabled(true);
```

`main.ts`'s first statement then runs after its imports are evaluated, but that's fine: nothing throws during import, and every later stack trace is translated.

- [ ] **Step 8: Run what CI runs**

Run: `pnpm format:check && API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build`
Expected: every task succeeds.

Run: `pnpm --filter @wishlist/api test:integration` (Docker running)
Expected: PASS. No test sets `SENTRY_DSN`, so every test app gets `NOOP_REPORTER`.

- [ ] **Step 9: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/observability apps/api/src/core/env.ts \
  apps/api/src/core/core.module.ts apps/api/src/testing/fakes.ts apps/api/src/main.ts
git commit -m "feat(api): add an ErrorReporter port with a scrubbing Sentry adapter

Co-Authored-By: <the model that wrote this commit> <noreply@anthropic.com>"
```

---

### Task 3: The API's five capture points

**Files:**
- Modify: `apps/api/src/http/problem-details.filter.ts` (+ `.spec.ts`)
- Modify: `apps/api/src/configure-app.ts`
- Modify: `apps/api/src/email/mailer.ts` (+ `.spec.ts`)
- Modify: `apps/api/src/security/captcha.ts` (+ `captcha.spec.ts`)
- Modify: `apps/api/src/security/breached-passwords.ts` (+ its spec)
- Modify: `apps/api/src/security/security.module.ts`
- Modify: `apps/api/src/db/pool.ts`, `apps/api/src/db/database.module.ts`
- Create: `apps/api/src/db/pool.spec.ts`

**Interfaces:**
- Consumes: `ErrorReporter`, `ERROR_REPORTER`, `NOOP_REPORTER`, `FakeErrorReporter` (Task 2).
- Produces:
  - `new ProblemDetailsFilter(reporter: ErrorReporter = NOOP_REPORTER)`;
  - `new TurnstileVerifier(secret, fetchFn = fetch, reporter = NOOP_REPORTER)`;
  - `new PwnedPasswordsChecker(fetchFn = fetch, reporter = NOOP_REPORTER)`;
  - `createPool(connectionString, reporter = NOOP_REPORTER)`;
  - `Mailer` injects `ERROR_REPORTER` as an optional second parameter.

  The defaults keep every existing constructor call compiling.

- [ ] **Step 1: Write the failing filter tests**

Append to `apps/api/src/http/problem-details.filter.spec.ts` (add `import { FakeErrorReporter } from '../testing/fakes.js';` and `import type { ErrorReporter } from '../observability/error-reporter.js';`). The existing `fakeHost()` returns no request, so these tests pass their own host:

```ts
function hostWith(route?: string) {
  const { host, res } = fakeHost();
  const req = route ? { route: { path: route } } : {};
  const withRequest = {
    switchToHttp: () => ({ ...host.switchToHttp(), getRequest: <T>() => req as unknown as T }),
  } as unknown as ArgumentsHost;
  return { host: withRequest, res };
}

describe('ProblemDetailsFilter reporting', () => {
  beforeEach(() => vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));
  afterEach(() => vi.restoreAllMocks());

  it('reports an unexpected error with its request ID and route pattern', () => {
    const reporter = new FakeErrorReporter();
    const error = new Error('boom');
    const { host } = hostWith('/api/claims/:manageToken');
    new ProblemDetailsFilter(reporter).catch(error, host);
    expect(reporter.exceptions).toEqual([
      { error, context: { requestId: 'req-1', route: '/api/claims/:manageToken' } },
    ]);
  });

  it('reports nothing for a 4xx', () => {
    const reporter = new FakeErrorReporter();
    const { host } = hostWith('/api/x');
    new ProblemDetailsFilter(reporter).catch(new NotFoundException(), host);
    expect(reporter.exceptions).toEqual([]);
  });

  it('still sends the 500 problem when the reporter throws (Review Focus #3)', () => {
    const throwing: ErrorReporter = {
      captureException: () => {
        throw new Error('reporter broke');
      },
      captureWarning: () => undefined,
    };
    const { host, res } = hostWith('/api/x');
    expect(() => new ProblemDetailsFilter(throwing).catch(new Error('boom'), host)).not.toThrow();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalled();
  });
});
```

Add `NotFoundException` to the `@nestjs/common` import.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @wishlist/api test -- problem-details.filter`
Expected: FAIL: the filter takes no reporter, so `reporter.exceptions` stays empty.

- [ ] **Step 3: Make the filter report**

Replace the class in `apps/api/src/http/problem-details.filter.ts` (keep `describeForLog` as it is):

```ts
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemDetails');

  constructor(private readonly reporter: ErrorReporter = NOOP_REPORTER) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const problem = toProblem(exception, requestIdOf(res));
    if (problem.status >= 500) {
      this.logger.error(`[${problem.requestId}] unhandled error`, describeForLog(exception));
      this.report(exception, problem.requestId, http.getRequest<Request | undefined>());
    }
    if (exception instanceof AppError) {
      for (const [name, value] of Object.entries(exception.headers)) res.setHeader(name, value);
    }
    sendProblem(res, problem);
  }

  /** The route pattern, never the URL: it carries tokens (spec §6.7). Reporting can't throw. */
  private report(exception: unknown, requestId: string, req: Request | undefined): void {
    try {
      const route: unknown = req?.route?.path;
      this.reporter.captureException(exception, {
        requestId,
        ...(typeof route === 'string' ? { route } : {}),
      });
    } catch {
      // The response matters more than the report.
    }
  }
}
```

Change the imports: `import type { Request, Response } from 'express';` and `import { NOOP_REPORTER, type ErrorReporter } from '../observability/error-reporter.js';`.

In `apps/api/src/configure-app.ts`, import `ERROR_REPORTER`, `NOOP_REPORTER` and `type ErrorReporter` from `./observability/error-reporter.js`, and replace `app.useGlobalFilters(new ProblemDetailsFilter());` with:

```ts
  app.useGlobalFilters(new ProblemDetailsFilter(reporterOf(app)));
```

and add below `configureApp`:

```ts
/** The app's reporter. Unit-test apps built without CoreModule have none, and report nowhere. */
function reporterOf(app: NestExpressApplication): ErrorReporter {
  try {
    return app.get<ErrorReporter>(ERROR_REPORTER, { strict: false });
  } catch {
    return NOOP_REPORTER;
  }
}
```

Run: `pnpm --filter @wishlist/api test -- problem-details.filter`
Expected: PASS, the existing logging tests included.

- [ ] **Step 4: Write the failing tests for the other four**

Append to `apps/api/src/email/mailer.spec.ts` (import `FakeErrorReporter` from `../testing/fakes.js`):

```ts
  it('reports a failed delivery without the recipient (spec §9)', async () => {
    const sender = new FakeEmailSender();
    sender.failNext = true;
    const reporter = new FakeErrorReporter();
    new Mailer(sender, reporter).queue(message);
    await new Promise((resolve) => setImmediate(resolve));
    expect(reporter.exceptions).toHaveLength(1);
    expect(JSON.stringify(reporter.exceptions)).not.toContain('ada@example.com');
  });
```

Append to `apps/api/src/security/captcha.spec.ts`, inside its top-level `describe`. Reuse the file's existing way of building a `fetch` that answers a status and body; the test needs a `400` whose body is `{"success":false,"error-codes":["invalid-input-secret"]}`. Name that helper `respond` if it isn't already.

```ts
  it('reports an unavailable verdict to the error reporter as a warning', async () => {
    const reporter = new FakeErrorReporter();
    const verifier = new TurnstileVerifier(
      'secret',
      respond(400, { success: false, 'error-codes': ['invalid-input-secret'] }),
      reporter,
    );
    expect(await verifier.verify('token', '203.0.113.7')).toBe('unavailable');
    expect(reporter.warnings).toEqual([
      { message: 'captcha unavailable: siteverify answered HTTP 400 (invalid-input-secret)' },
    ]);
  });
```

Append to `apps/api/src/security/breached-passwords.spec.ts` (create the file with the imports below if it doesn't exist):

```ts
import { describe, expect, it } from 'vitest';
import { FakeErrorReporter } from '../testing/fakes.js';
import { PwnedPasswordsChecker } from './breached-passwords.js';

describe('PwnedPasswordsChecker reporting', () => {
  it('reports a skipped check as a warning, never the password', async () => {
    const reporter = new FakeErrorReporter();
    const down = (() => Promise.resolve(new Response('', { status: 503 }))) as typeof fetch;
    expect(await new PwnedPasswordsChecker(down, reporter).isBreached('hunter2 hunter2')).toBe(false);
    expect(reporter.warnings).toEqual([{ message: 'breach check skipped: HIBP answered 503' }]);
    expect(JSON.stringify(reporter.warnings)).not.toContain('hunter2');
  });
});
```

Create `apps/api/src/db/pool.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FakeErrorReporter } from '../testing/fakes.js';
import { createPool } from './pool.js';

describe('createPool', () => {
  it('reports an idle client error as a warning instead of crashing', async () => {
    const reporter = new FakeErrorReporter();
    const pool = createPool('postgres://nobody@127.0.0.1:1/none', reporter);
    pool.emit('error', new Error('Connection terminated unexpectedly'));
    expect(reporter.warnings).toEqual([
      { message: 'idle client error: Connection terminated unexpectedly' },
    ]);
    await pool.end();
  });
});
```

- [ ] **Step 5: Run them and watch them fail**

Run: `pnpm --filter @wishlist/api test -- mailer captcha breached pool`
Expected: FAIL: the constructors ignore the extra argument, so nothing is recorded.

- [ ] **Step 6: Report from all four**

`apps/api/src/email/mailer.ts`:
- **Constructor:**
  ```ts
  constructor(
    @Inject(EMAIL_SENDER) private readonly sender: EmailSender,
    @Optional() @Inject(ERROR_REPORTER) private readonly reporter: ErrorReporter = NOOP_REPORTER,
  ) {}
  ```
- **Imports:** add `Optional` to the `@nestjs/common` import, plus `ERROR_REPORTER`, `NOOP_REPORTER` and `type ErrorReporter`.
- **Error handler:** after the existing `this.logger.error(…)` call, add `this.reporter.captureException(error);`.
- **Comment:** change "Sentry arrives in Plan 5." to "Sentry gets the error itself; neither carries the recipient."

`apps/api/src/security/captcha.ts`:
- **Constructor:** add a third parameter, `private readonly reporter: ErrorReporter = NOOP_REPORTER`.
- **`unavailable()`:** after `this.logger.warn(…)`, add `this.reporter.captureWarning(\`captcha unavailable: ${reason}\`);`.
- **Imports:** `NOOP_REPORTER` and `type ErrorReporter`.

`apps/api/src/security/breached-passwords.ts`:
- **Constructor:** `constructor(private readonly fetchFn: typeof fetch = fetch, private readonly reporter: ErrorReporter = NOOP_REPORTER) {}`.
- **Catch block:** build the message once, log it, then report it:
  ```ts
      const message = `breach check skipped: ${error instanceof Error ? error.message : String(error)}`;
      this.logger.warn(message);
      this.reporter.captureWarning(message);
  ```

`apps/api/src/db/pool.ts`:
- **Signature:** `export function createPool(connectionString: string, reporter: ErrorReporter = NOOP_REPORTER): Pool`.
- **Error listener:**
  ```ts
  pool.on('error', (err) => {
    logger.warn(`idle client error: ${err.message}`);
    reporter.captureWarning(`idle client error: ${err.message}`);
  });
  ```

Wiring:
- **`security.module.ts`:** each factory injects `ERROR_REPORTER` after `ENV`:
  ```ts
    {
      provide: CAPTCHA_VERIFIER,
      inject: [ENV, ERROR_REPORTER],
      useFactory: (env: Env, reporter: ErrorReporter) =>
        new TurnstileVerifier(env.TURNSTILE_SECRET_KEY, fetch, reporter),
    },
    {
      provide: BREACHED_PASSWORD_CHECKER,
      inject: [ERROR_REPORTER],
      useFactory: (reporter: ErrorReporter) => new PwnedPasswordsChecker(fetch, reporter),
    },
  ```
- **`database.module.ts`:** the `PG_POOL` factory becomes `inject: [ENV, ERROR_REPORTER], useFactory: (env: Env, reporter: ErrorReporter): Pool => createPool(env.DATABASE_URL, reporter)`.

- [ ] **Step 7: Run the unit tests, then everything CI runs**

Run: `pnpm --filter @wishlist/api test`
Expected: PASS, including the six new tests.

Run: `pnpm format:check && API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build && pnpm --filter @wishlist/api test:integration`
Expected: every task succeeds, and integration passes.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/http apps/api/src/configure-app.ts apps/api/src/email apps/api/src/security apps/api/src/db
git commit -m "feat(api): report 500s, failed email and operator warnings to Sentry

Co-Authored-By: <the model that wrote this commit> <noreply@anthropic.com>"
```

---

### Task 4: The web's pure pieces: scrubber, DSN origin, boundary rule, CSP

**Files:**
- Create: `apps/web/src/lib/observability.ts`
- Create: `apps/web/src/lib/observability.spec.ts`
- Modify: `apps/web/src/lib/csp.ts` (+ its spec, `apps/web/src/lib/csp.spec.ts`, created if absent)
- Modify: `apps/web/src/proxy.ts`
- Modify: `apps/web/next.config.ts`

**Interfaces:**
- Consumes: `redactDeep` (Task 1).
- Produces, from `@/lib/observability`:
  - `scrubEvent(event: ErrorEvent): ErrorEvent | null`;
  - `sentryIngestOrigin(dsn: string | undefined): string | undefined`;
  - `shouldReportBoundaryError(error: { digest?: string }): boolean`;
  - `DATA_COLLECTION_OFF`.
- Produces: `contentSecurityPolicy({ nonce, dev, sentryOrigin?: string })`. `next.config.ts` inlines `SENTRY_DSN_WEB` and `SENTRY_RELEASE` into server and browser code.

- [ ] **Step 1: Add the dependencies**

Run: `pnpm --filter @wishlist/web add @sentry/browser@11.8.0 @sentry/node@11.8.0 @vercel/functions@3.9.11 --save-exact`
Expected: three exact pins in `apps/web/package.json`, and the lockfile updated.

- [ ] **Step 2: Write the failing tests**

Create `apps/web/src/lib/observability.spec.ts`:

```ts
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
```

In the CSP spec (`apps/web/src/lib/csp.spec.ts`; create it with the imports below if it doesn't exist), add:

```ts
import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from './csp';

const connectSrc = (csp: string) => csp.split('; ').find((d) => d.startsWith('connect-src '));

describe('contentSecurityPolicy connect-src (spec §6.9, D51)', () => {
  it('is only self without a Sentry origin', () => {
    expect(connectSrc(contentSecurityPolicy({ nonce: 'n', dev: false }))).toBe("connect-src 'self'");
  });

  it('adds exactly the Sentry ingest origin when there is one', () => {
    expect(
      connectSrc(
        contentSecurityPolicy({ nonce: 'n', dev: false, sentryOrigin: 'https://o456.ingest.us.sentry.io' }),
      ),
    ).toBe("connect-src 'self' https://o456.ingest.us.sentry.io");
  });
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `pnpm --filter @wishlist/web test`
Expected: FAIL: `./observability` doesn't exist, and `connect-src` ignores `sentryOrigin`.

- [ ] **Step 4: Write the module and extend the CSP**

Create `apps/web/src/lib/observability.ts`:

```ts
import type { BrowserOptions, ErrorEvent } from '@sentry/browser';
import { redactDeep } from '@wishlist/contracts';

/**
 * Everything the SDK would collect on its own, switched off (spec §6.7). v11's defaults collect
 * cookies, headers, bodies and stack-frame variables. Node and the browser share the type.
 */
export const DATA_COLLECTION_OFF = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
} satisfies NonNullable<BrowserOptions['dataCollection']>;

/**
 * Sentry's beforeSend, in the browser and on the web server (spec §6.7). The request keeps only
 * its URL, the user goes, and every string left is redacted.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent | null {
  const { user: _user, request, ...rest } = event;
  const kept: ErrorEvent = { ...rest };
  if (request?.url) kept.request = { url: request.url };
  return redactDeep(kept);
}

/** The origin browsers post reports to, for connect-src (D51). Only an https DSN counts. */
export function sentryIngestOrigin(dsn: string | undefined): string | undefined {
  if (!dsn) return undefined;
  try {
    const url = new URL(dsn);
    return url.protocol === 'https:' ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * error.tsx reports what it catches, except an error with a digest: that one came from a server
 * render, which onRequestError already reported, and its message is a placeholder.
 */
export function shouldReportBoundaryError(error: { digest?: string }): boolean {
  return !error.digest;
}
```

In `apps/web/src/lib/csp.ts`:
- **Signature:** `export function contentSecurityPolicy({ nonce, dev, sentryOrigin }: { nonce: string; dev: boolean; sentryOrigin?: string }): string`.
- **`connect-src`:** replace `"connect-src 'self'",` with:
  ```ts
      // Browser error reports go straight to Sentry, and only to the DSN's origin (D51).
      `connect-src 'self'${sentryOrigin ? ` ${sentryOrigin}` : ''}`,
  ```

In `apps/web/src/proxy.ts`, import `sentryIngestOrigin` from `@/lib/observability` and change the CSP call to:

```ts
  const csp = contentSecurityPolicy({
    nonce,
    dev: process.env.NODE_ENV === 'development',
    sentryOrigin: sentryIngestOrigin(process.env.SENTRY_DSN_WEB),
  });
```

In `apps/web/next.config.ts`:
- **Inline the DSN and release:** replace `env: { API_ORIGIN, TURNSTILE_SITE_KEY },` with:
  ```ts
    // Sentry's web DSN and release, inlined at build. Only deploy.yml sets SENTRY_DSN_WEB, so
    // previews, CI and local builds carry none and report nothing (spec §10, D50).
    env: {
      API_ORIGIN,
      TURNSTILE_SITE_KEY,
      SENTRY_DSN_WEB: process.env.SENTRY_DSN_WEB ?? '',
      SENTRY_RELEASE: process.env.GITHUB_SHA ?? 'dev',
    },
  ```
- **Server maps:** add to the config object:
  ```ts
    // Maps for the server bundles, so the web server reports TypeScript lines at runtime (D52).
    experimental: { serverSourceMaps: true },
  ```
- **If `pnpm --filter @wishlist/web typecheck` rejects `experimental.serverSourceMaps`,** find the option's current name in `node_modules/next/dist/server/config-shared.d.ts`. It's declared there; this plan checked it on 2026-10-19. Then ledger a ruling.

- [ ] **Step 5: Run the tests, then everything CI runs**

Run: `pnpm --filter @wishlist/web test`
Expected: PASS.

Run: `pnpm format:check && API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build`
Expected: every task succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/lib/observability.ts apps/web/src/lib/observability.spec.ts \
  apps/web/src/lib/csp.ts apps/web/src/lib/csp.spec.ts apps/web/src/proxy.ts apps/web/next.config.ts
git commit -m "feat(web): add the Sentry scrubber, the DSN's CSP origin and the boundary rule

Co-Authored-By: <the model that wrote this commit> <noreply@anthropic.com>"
```

---

### Task 5: The web's capture, production-only by policy

**Files:**
- Create: `apps/web/src/lib/sentry.server.ts`
- Create: `apps/web/src/instrumentation.ts`
- Create: `apps/web/src/instrumentation-client.ts`
- Modify: `apps/web/src/app/error.tsx`
- Create: `e2e/tests/local/sentry.spec.ts`
- Modify: `.github/workflows/deploy.yml` (the `build` job's `env`)
- Modify: `scripts/workflow-policy.test.mjs`, `scripts/workflow-policy.mutations.test.mjs`

**Interfaces:**
- Consumes: `scrubEvent`, `DATA_COLLECTION_OFF`, `shouldReportBoundaryError` (Task 4). `process.env.SENTRY_DSN_WEB` and `process.env.SENTRY_RELEASE`, inlined by `next.config.ts`.
- Produces: `initServerReporting(dsn: string, release: string): void` and `reportRequestError(error: unknown, routePath: string, routeType: string): void` from `@/lib/sentry.server`.

- [ ] **Step 1: Write the failing E2E test and policy rule**

Create `e2e/tests/local/sentry.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

// CI and local builds have no SENTRY_DSN_WEB, the same as a preview (spec §10, D50). Such a
// build must never talk to Sentry, and its CSP must not allow it to (Review Focus #4).
test('a build without a DSN sends nothing to Sentry, and its CSP allows only self', async ({
  page,
}) => {
  const sentryRequests: string[] = [];
  page.on('request', (req) => {
    if (/sentry\.io/i.test(new URL(req.url()).hostname)) sentryRequests.push(req.url());
  });
  const res = await page.goto('/');
  // An uncaught error is what the browser SDK would report, if it were initialized.
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('e2e: no DSN, so nobody hears this');
    });
  });
  await page.goto('/signup');
  await page.waitForLoadState('networkidle');
  expect(sentryRequests).toEqual([]);
  const csp = res?.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("connect-src 'self';");
});
```

In `scripts/workflow-policy.test.mjs`, insert before the `// Secret jobs run \`npx vercel@<this version>\`` comment:

```js
// Rule 9 (Plan 5b, D50): the web DSN reaches only the production build. A preview, CI or any
// other job that inlined it would report from unreviewed code.
for (const { file, wf } of workflows) {
  for (const [jobName, job] of Object.entries(wf.jobs ?? {})) {
    const allowed = file === 'deploy.yml' && jobName === 'build';
    if (!allowed && JSON.stringify(job).includes('SENTRY_DSN_WEB'))
      fail(`${file}#${jobName}: only deploy.yml#build may read SENTRY_DSN_WEB`);
  }
}
if (!JSON.stringify(byFile['deploy.yml']?.jobs?.build ?? {}).includes('vars.SENTRY_DSN_WEB'))
  fail('deploy.yml#build: set SENTRY_DSN_WEB from vars.SENTRY_DSN_WEB');
```

Run: `node scripts/workflow-policy.test.mjs`
Expected: FAIL with `deploy.yml#build: set SENTRY_DSN_WEB from vars.SENTRY_DSN_WEB`.

- [ ] **Step 2: Give the production build its DSN**

In `.github/workflows/deploy.yml`, in the `build` job's `env:` block, after `TURNSTILE_SITE_KEY`, add:

```yaml
      # Sentry's web DSN, public by design. Only this job reads it (policy Rule 9), so no other
      # build reports (spec §10, D50).
      SENTRY_DSN_WEB: ${{ vars.SENTRY_DSN_WEB }}
```

Add this mutation to `scripts/workflow-policy.mutations.test.mjs`:

```js
  [
    'a preview build inlines the web DSN (D50)',
    'preview.yml',
    (wf) => {
      const job = wf.jobs['build-web'];
      job.env = { ...(job.env ?? {}), SENTRY_DSN_WEB: '${{ vars.SENTRY_DSN_WEB }}' };
    },
  ],
```

Run: `node scripts/workflow-policy.test.mjs && node scripts/workflow-policy.mutations.test.mjs`
Expected: `workflow-policy: ok`, and the mutation count is one higher than before.

- [ ] **Step 3: Write the server and browser capture**

Create `apps/web/src/lib/sentry.server.ts`:

```ts
import 'server-only';
import * as Sentry from '@sentry/node';
import { waitUntil } from '@vercel/functions';
import { DATA_COLLECTION_OFF, scrubEvent } from './observability';

/** Explicit capture only (D50), as in the API: nothing is reported but onRequestError's errors. */
export function initServerReporting(dsn: string, release: string): void {
  Sentry.init({
    dsn,
    release,
    environment: 'production',
    defaultIntegrations: false,
    integrations: [Sentry.linkedErrorsIntegration(), Sentry.dedupeIntegration()],
    enableRuntimeChannelInjection: false,
    includeLocalVariables: false,
    dataCollection: DATA_COLLECTION_OFF,
    beforeSend: scrubEvent,
  });
}

/**
 * A render, route or action error from onRequestError, grouped by the route pattern
 * (/s/[shareToken]), never the path. Flushed with waitUntil, since Vercel may freeze the function
 * once the response is sent. Reporting never throws.
 */
export function reportRequestError(error: unknown, routePath: string, routeType: string): void {
  try {
    Sentry.withScope((scope) => {
      scope.setTransactionName(routePath);
      scope.setTag('routeType', routeType);
      Sentry.captureException(error);
    });
    waitUntil(Sentry.flush(2_000));
  } catch {
    // The page's own error handling goes on regardless.
  }
}
```

Create `apps/web/src/instrumentation.ts`:

```ts
import type { Instrumentation } from 'next';

// Inlined at build by next.config.ts. Empty outside production deploys.
const dsn = process.env.SENTRY_DSN_WEB;

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || !dsn) return;
  // The server bundles carry source maps (next.config.ts): report TypeScript lines (D52).
  process.setSourceMapsEnabled(true);
  const { initServerReporting } = await import('./lib/sentry.server');
  initServerReporting(dsn, process.env.SENTRY_RELEASE ?? 'dev');
}

export const onRequestError: Instrumentation.onRequestError = async (error, _request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || !dsn) return;
  const { reportRequestError } = await import('./lib/sentry.server');
  reportRequestError(error, context.routePath, context.routeType);
};
```

Create `apps/web/src/instrumentation-client.ts`:

```ts
import * as Sentry from '@sentry/browser';
import { DATA_COLLECTION_OFF, scrubEvent } from '@/lib/observability';

// Inlined at build by next.config.ts. Empty outside production deploys, so this does nothing.
const dsn = process.env.SENTRY_DSN_WEB;

if (dsn) {
  Sentry.init({
    dsn,
    release: process.env.SENTRY_RELEASE,
    environment: 'production',
    defaultIntegrations: false,
    integrations: [
      Sentry.globalHandlersIntegration(),
      Sentry.linkedErrorsIntegration(),
      Sentry.dedupeIntegration(),
    ],
    dataCollection: DATA_COLLECTION_OFF,
    beforeSend: scrubEvent,
  });
}
```

In `apps/web/src/app/error.tsx`, add the imports `import { captureException } from '@sentry/browser';`, `import { useEffect } from 'react';` and `import { shouldReportBoundaryError } from '@/lib/observability';`. Rename the destructured props to `{ error, retry }`, and add as the component's first statement:

```tsx
  // A client-side error reaches Sentry here. A server one, which has a digest, already did
  // through onRequestError (spec §9).
  useEffect(() => {
    if (shouldReportBoundaryError(error)) captureException(error);
  }, [error]);
```

Update the component's doc comment to: `/** Shown when a page throws. It never shows the error's own text (spec §9), and reports a client-side one. */`

- [ ] **Step 4: Build, measure, and run the E2E test**

Run: `pnpm format:check && API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck test build`
Expected: every task succeeds.

**Measure the browser cost** (the design estimated 15–20 KB gzipped):
1. Run `find apps/web/.next/static -name '*.js' -exec cat {} + | gzip -c | wc -c` on this build.
2. Run the same on a build of the commit before this task (`git stash`, rebuild, measure, `git stash pop`).
3. Put both numbers and the difference in the task report.

Run: `pnpm test:e2e` (Docker running)
Expected: PASS, including `a build without a DSN sends nothing to Sentry, and its CSP allows only self`.

Run: `node scripts/workflow-policy.test.mjs && node scripts/workflow-policy.mutations.test.mjs`, then the actionlint command from `ci.yml`.
Expected: both pass, and actionlint prints nothing.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/sentry.server.ts apps/web/src/instrumentation.ts apps/web/src/instrumentation-client.ts \
  apps/web/src/app/error.tsx e2e/tests/local/sentry.spec.ts .github/workflows/deploy.yml \
  scripts/workflow-policy.test.mjs scripts/workflow-policy.mutations.test.mjs
git commit -m "feat(web): report server and browser errors to Sentry, from production builds only

Co-Authored-By: <the model that wrote this commit> <noreply@anthropic.com>"
```

---

### Task 6: The source-map scripts

**Files:**
- Create: `scripts/install-sentry-cli.sh` (+ `scripts/install-sentry-cli.test.sh`)
- Create: `scripts/extract-sourcemaps.sh` (+ `scripts/extract-sourcemaps.test.sh`)
- Modify: `scripts/check-vercel-output.sh` (+ `scripts/check-vercel-output.test.sh`)
- Modify: `apps/web/next.config.ts` (`productionBrowserSourceMaps`)
- Modify: `.github/workflows/ci.yml` ("Script tests")

**Interfaces:**
- Produces:
  - `scripts/install-sentry-cli.sh <dir>`: installs `sentry-cli` 3.8.0 at `<dir>/sentry-cli` after checking its sha256, or exits non-zero leaving nothing.
  - `scripts/extract-sourcemaps.sh <static-dir> <dest>`: if `<static-dir>` has any `*.map`, runs `sentry-cli sourcemaps inject` on it, copies each map's chunk into `<dest>` and **moves** the map there, then fails if a `.map` remains. It always writes `<dest>/README.txt`, so the artifact upload never comes up empty.
  - `check-vercel-output.sh` refuses any `.map` under `<dir>/static`.

  Task 7 calls all three.

- [ ] **Step 1: Write the failing tests**

Create `scripts/install-sentry-cli.test.sh` and `chmod +x` it:

```bash
#!/usr/bin/env bash
# Verifies install-sentry-cli.sh pins one release and refuses a download that fails its checksum.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin"
# A curl that "downloads" the wrong bytes to wherever -o points.
cat > "$tmp/bin/curl" <<'EOF'
#!/usr/bin/env bash
while (( $# )); do
  if [[ "$1" == -o ]]; then printf 'not sentry-cli' > "$2"; fi
  shift
done
EOF
chmod +x "$tmp/bin/curl"

grep -q '^version=3\.8\.0$' "$here/install-sentry-cli.sh" || { echo "install-sentry-cli.test: pin version=3.8.0" >&2; exit 1; }
grep -Eq '^sha256=[0-9a-f]{64}$' "$here/install-sentry-cli.sh" || { echo "install-sentry-cli.test: pin a sha256" >&2; exit 1; }

if PATH="$tmp/bin:$PATH" "$here/install-sentry-cli.sh" "$tmp/out" >/dev/null 2>&1; then
  echo "install-sentry-cli.test: accepted a download that failed its checksum" >&2
  exit 1
fi
[[ ! -e "$tmp/out/sentry-cli" ]] || { echo "install-sentry-cli.test: left a binary behind after refusing it" >&2; exit 1; }
echo "install-sentry-cli: ok"
```

Create `scripts/extract-sourcemaps.test.sh` and `chmod +x` it:

```bash
#!/usr/bin/env bash
# Verifies extract-sourcemaps.sh injects, moves every map out of the deploy output with its chunk
# copied beside it, and always leaves an artifact to upload.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin"
cat > "$tmp/bin/sentry-cli" <<'EOF'
#!/usr/bin/env bash
echo "sentry-cli $*" >> "$STUB_LOG"
EOF
chmod +x "$tmp/bin/sentry-cli"
export STUB_LOG="$tmp/log"
fail() { echo "extract-sourcemaps.test: $*" >&2; exit 1; }

static="$tmp/static" dest="$tmp/maps"
mkdir -p "$static/_next/static/chunks" "$static/_next/static/css"
echo 'a()' > "$static/_next/static/chunks/a.js"
echo '{}' > "$static/_next/static/chunks/a.js.map"
echo 'b()' > "$static/_next/static/chunks/b.js"
echo 'x{}' > "$static/_next/static/css/s.css"
echo '{}' > "$static/_next/static/css/s.css.map"

: > "$STUB_LOG"
PATH="$tmp/bin:$PATH" "$here/extract-sourcemaps.sh" "$static" "$dest" >/dev/null || fail "a normal output should extract"
grep -qx "sentry-cli sourcemaps inject $static" "$STUB_LOG" || fail "inject debug IDs into the output first"
[[ -f "$dest/_next/static/chunks/a.js.map" && -f "$dest/_next/static/chunks/a.js" ]] || fail "move the map, copy its chunk"
[[ -f "$dest/_next/static/css/s.css.map" ]] || fail "move CSS maps too"
[[ -f "$static/_next/static/chunks/a.js" ]] || fail "leave the chunk in the deploy output"
[[ ! -e "$dest/_next/static/chunks/b.js" ]] || fail "copy only chunks that have a map"
! find "$static" -name '*.map' | grep -q . || fail "no map may remain in the deploy output"
[[ -f "$dest/README.txt" ]] || fail "always write README.txt"

rm -rf "$static" "$dest" && mkdir -p "$static/_next" && echo 'c()' > "$static/_next/c.js"
: > "$STUB_LOG"
PATH="$tmp/bin:$PATH" "$here/extract-sourcemaps.sh" "$static" "$dest" >/dev/null || fail "an output without maps is fine"
[[ ! -s "$STUB_LOG" ]] || fail "without maps there is nothing to inject"
[[ -f "$dest/README.txt" ]] || fail "write README.txt even without maps, so the artifact exists"
echo "extract-sourcemaps: ok"
```

In `scripts/check-vercel-output.test.sh`, insert before the final `echo "check-vercel-output: ok"`:

```bash
# Browser source maps go to Sentry (scripts/extract-sourcemaps.sh), never to visitors.
rm -rf "$work/mapped" && cp -R "$work/good" "$work/mapped"
mkdir -p "$work/mapped/static/_next/static/chunks"
echo '{}' > "$work/mapped/static/_next/static/chunks/a.js.map"
if "$here/check-vercel-output.sh" "$work/mapped" >/dev/null 2>&1; then
  echo "check-vercel-output: FAIL: accepted an output that would serve a source map" >&2
  exit 1
fi
```

- [ ] **Step 2: Run them and watch them fail**

Run: `scripts/install-sentry-cli.test.sh; scripts/extract-sourcemaps.test.sh; scripts/check-vercel-output.test.sh`
Expected: the first two fail with "No such file or directory", and the third fails with `accepted an output that would serve a source map`.

- [ ] **Step 3: Write the scripts**

Create `scripts/install-sentry-cli.sh` and `chmod +x` it:

```bash
#!/usr/bin/env bash
# Installs sentry-cli for the jobs that inject and upload browser source maps (D52): one pinned
# release whose sha256 is checked before it runs, never a package manager.
# Usage: scripts/install-sentry-cli.sh <dir>   (then add <dir> to PATH)
set -euo pipefail

version=3.8.0
sha256=13f8cb34ae01a6a272d7d7c22e277a105286615b4020de900ea95a8de47cdbb6

dir="${1:?usage: install-sentry-cli.sh <dir>}"
mkdir -p "$dir"
download="$dir/sentry-cli.download"
curl -fsSL -o "$download" "https://github.com/getsentry/sentry-cli/releases/download/$version/sentry-cli-Linux-x86_64"
if ! echo "$sha256  $download" | sha256sum -c - >/dev/null 2>&1; then
  rm -f "$download"
  echo "::error::sentry-cli $version failed its checksum; refusing to run it" >&2
  exit 1
fi
chmod +x "$download"
mv "$download" "$dir/sentry-cli"
echo "sentry-cli $version installed in $dir"
```

Create `scripts/extract-sourcemaps.sh` and `chmod +x` it:

```bash
#!/usr/bin/env bash
# Takes the browser source maps out of a web build's deploy output (D52). sentry-cli first writes
# a debug ID into each chunk and its map, so Sentry pairs them without release bookkeeping. Each
# map then moves to <dest> with a copy of its chunk, and hanker.dev never serves it.
# Usage: scripts/extract-sourcemaps.sh <static-dir> <dest>   (sentry-cli on PATH)
set -euo pipefail

src="${1:?usage: extract-sourcemaps.sh <static-dir> <dest>}"
dest="${2:?usage: extract-sourcemaps.sh <static-dir> <dest>}"
mkdir -p "$dest"
# Always something to upload, so the sourcemaps job's download never fails on an empty artifact.
echo "Browser source maps for Sentry, from scripts/extract-sourcemaps.sh" > "$dest/README.txt"

if ! find "$src" -name '*.map' -print -quit | grep -q .; then
  echo "no source maps under $src; nothing to extract"
  exit 0
fi

sentry-cli sourcemaps inject "$src"
moved=0
while IFS= read -r -d '' map; do
  rel="${map#"$src"/}"
  mkdir -p "$dest/$(dirname "$rel")"
  if [[ -f "${map%.map}" ]]; then cp "${map%.map}" "$dest/${rel%.map}"; fi
  mv "$map" "$dest/$rel"
  moved=$((moved + 1))
done < <(find "$src" -name '*.map' -print0)

if find "$src" -name '*.map' -print -quit | grep -q .; then
  echo "::error::source maps remain under $src after extraction" >&2
  exit 1
fi
echo "moved $moved source maps to $dest"
```

In `scripts/check-vercel-output.sh`, insert before the final `echo "build output complete: $dir"`:

```bash
# Browser source maps go to Sentry (scripts/extract-sourcemaps.sh), never to visitors (D52).
if [[ -d "$dir/static" ]] && find "$dir/static" -name '*.map' -print -quit | grep -q .; then
  echo "::error::$dir/static contains source maps; extract them before deploying" >&2
  exit 1
fi
```

In `apps/web/next.config.ts`, add to the config object:

```ts
  // Browser source maps only for a build that reports. deploy.yml moves them out of the deploy
  // output and uploads them to Sentry, so they're never served (D52).
  productionBrowserSourceMaps: Boolean(process.env.SENTRY_DSN_WEB),
```

Add `scripts/install-sentry-cli.test.sh` and `scripts/extract-sourcemaps.test.sh` to CI's "Script tests" step, each on its own line after `scripts/restore-drill.test.sh`.

- [ ] **Step 4: Run the tests, and check the real binary once**

Run: `scripts/install-sentry-cli.test.sh && scripts/extract-sourcemaps.test.sh && scripts/check-vercel-output.test.sh`
Expected: `install-sentry-cli: ok`, `extract-sourcemaps: ok`, `check-vercel-output: ok`.

Run: `d=$(mktemp -d) && scripts/install-sentry-cli.sh "$d" && "$d/sentry-cli" --version; rm -rf "$d"`
Expected: `sentry-cli 3.8.0 installed in …` then `sentry-cli 3.8.0`. This is the real download passing the real checksum; the test can only prove the refusal.

Run: `node scripts/workflow-policy.test.mjs && node scripts/workflow-policy.mutations.test.mjs`, the actionlint command, and `pnpm format:check`.
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/install-sentry-cli.sh scripts/install-sentry-cli.test.sh scripts/extract-sourcemaps.sh \
  scripts/extract-sourcemaps.test.sh scripts/check-vercel-output.sh scripts/check-vercel-output.test.sh \
  apps/web/next.config.ts .github/workflows/ci.yml
git commit -m "feat(ops): add the source-map scripts, and refuse to deploy a served map

Co-Authored-By: <the model that wrote this commit> <noreply@anthropic.com>"
```

---

### Task 7: The `sourcemaps` job, its policy, and the Sentry runbook

**Files:**
- Modify: `.github/workflows/deploy.yml` (the `build` job, a new `sourcemaps` job)
- Modify: `scripts/workflow-policy.test.mjs`, `scripts/workflow-policy.mutations.test.mjs`
- Modify: `docs/deployment.md` (a new `## Sentry` section after `## Monitoring`)

**Interfaces:**
- Consumes: the three scripts (Task 6); `vars.SENTRY_ORG`, `vars.SENTRY_PROJECT_WEB`, `secrets.SENTRY_AUTH_TOKEN` (Ted, Task 11).

- [ ] **Step 1: Write the failing policy rules**

In `scripts/workflow-policy.test.mjs`:
- Change `const SAFE_ARTIFACTS = ['vercel-settings', 'api-output', 'web-output'];` to `const SAFE_ARTIFACTS = ['vercel-settings', 'api-output', 'web-output', 'web-sourcemaps'];`.
- Change `const PROD_JOBS = ['settings', 'migrate', 'deploy-api', 'deploy-web'];` to `const PROD_JOBS = ['settings', 'migrate', 'deploy-api', 'deploy-web', 'sourcemaps'];`.
- Insert before the `// Secret jobs run \`npx vercel@<this version>\`` comment:

```js
// Rule 10 (Plan 5b, D52): source maps reach Sentry from a job that holds only SENTRY_AUTH_TOKEN,
// runs sentry-cli only after installing it through its checksum check, and that no release waits
// on, so a Sentry outage never blocks a deploy (Review Focus #5).
const deployJobs = byFile['deploy.yml']?.jobs ?? {};
const mapsJob = deployJobs.sourcemaps;
if (!mapsJob) fail('deploy.yml: missing job sourcemaps');
const mapsSecrets = secretsIn(mapsJob ?? {}).filter((s) => s !== 'SENTRY_AUTH_TOKEN');
if (mapsSecrets.length)
  fail(`deploy.yml#sourcemaps: may hold only SENTRY_AUTH_TOKEN (got ${mapsSecrets.join(', ')})`);
for (const [jobName, job] of Object.entries(deployJobs)) {
  const needs = [job.needs ?? []].flat();
  if (needs.includes('sourcemaps')) fail(`deploy.yml#${jobName}: no job may wait on sourcemaps`);
  const steps = job.steps ?? [];
  const installAt = steps.findIndex((s) => /scripts\/install-sentry-cli\.sh/.test(s.run ?? ''));
  const usesAt = steps.findIndex((s) =>
    /(^|\n|\s)(sentry-cli|scripts\/extract-sourcemaps\.sh)\s/.test(s.run ?? ''),
  );
  if (usesAt !== -1 && (installAt === -1 || installAt > usesAt))
    fail(`deploy.yml#${jobName}: install sentry-cli with scripts/install-sentry-cli.sh before using it`);
}
```

Run: `node scripts/workflow-policy.test.mjs`
Expected: FAIL with `deploy.yml: missing job sourcemaps`, and `only settings, migrate, deploy-api, deploy-web, sourcemaps may use environment: production` doesn't fire, because no such job exists yet.

- [ ] **Step 2: Extract in the build job, and add the `sourcemaps` job**

In `.github/workflows/deploy.yml`'s `build` job:
- **Install `sentry-cli`:** add a step before "Build both apps (no secrets in this job)":
  ```yaml
      - name: Install sentry-cli (pinned release, checksum checked)
        run: |
          scripts/install-sentry-cli.sh "$RUNNER_TEMP/sentry-cli"
          echo "$RUNNER_TEMP/sentry-cli" >> "$GITHUB_PATH"
  ```
- **Extract the maps:** in the "Build both apps" loop, between `pnpm exec vercel build --prod --standalone` and the `tar` line, add:
  ```bash
            # The browser's source maps go to Sentry, never to visitors (D52).
            if [[ "$app" == web ]]; then scripts/extract-sourcemaps.sh .vercel/output/static web-sourcemaps; fi
  ```
- **Upload the artifact:** add after the `web-output` upload:
  ```yaml
      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: web-sourcemaps
          path: web-sourcemaps
          retention-days: 1
  ```

Add a job after `smoke`:

```yaml
  sourcemaps:
    name: sourcemaps
    # Beside the deploy, never in its way: no job needs this one (policy Rule 10).
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    environment:
      name: production
      deployment: false
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - run: scripts/assert-main-tip.sh
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          name: web-sourcemaps
          path: web-sourcemaps
      - name: Install sentry-cli (pinned release, checksum checked)
        run: |
          scripts/install-sentry-cli.sh "$RUNNER_TEMP/sentry-cli"
          echo "$RUNNER_TEMP/sentry-cli" >> "$GITHUB_PATH"
      - name: Upload the browser source maps to Sentry
        env:
          SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
          SENTRY_ORG: ${{ vars.SENTRY_ORG }}
          SENTRY_PROJECT: ${{ vars.SENTRY_PROJECT_WEB }}
        run: |
          if [[ -z "$SENTRY_AUTH_TOKEN" ]]; then
            echo "::notice::SENTRY_AUTH_TOKEN isn't set; skipping the source-map upload"
            exit 0
          fi
          sentry-cli sourcemaps upload --release "$GITHUB_SHA" web-sourcemaps
```

Compare the existing production jobs' first steps (for example `deploy-api`) and copy any `with:` that `scripts/assert-main-tip.sh` needs on its checkout, such as `fetch-depth`. Rule 3 requires the check immediately after checkout.

- [ ] **Step 3: Add the mutations**

Append to `scripts/workflow-policy.mutations.test.mjs`'s `mutations` array:

```js
  [
    'the sourcemaps job holds the Vercel token',
    'deploy.yml',
    (wf) => {
      const s = runStep(wf.jobs.sourcemaps, /sourcemaps upload/);
      s.env.VERCEL_TOKEN = '${{ secrets.VERCEL_TOKEN }}';
    },
  ],
  [
    'sentry-cli used before its checksum check',
    'deploy.yml',
    (wf) => {
      wf.jobs.sourcemaps.steps = wf.jobs.sourcemaps.steps.filter(
        (s) => !/install-sentry-cli/.test(s.run ?? ''),
      );
    },
  ],
  [
    'a release waits on the source-map upload',
    'deploy.yml',
    (wf) => {
      wf.jobs['deploy-web'].needs = [wf.jobs['deploy-web'].needs, 'sourcemaps'].flat();
    },
  ],
  [
    'the sourcemaps job skips the main-tip check',
    'deploy.yml',
    (wf) => {
      wf.jobs.sourcemaps.steps = wf.jobs.sourcemaps.steps.filter(
        (s) => s.run !== 'scripts/assert-main-tip.sh',
      );
    },
  ],
```

- [ ] **Step 4: Run the policy tests and actionlint**

Run: `node scripts/workflow-policy.test.mjs && node scripts/workflow-policy.mutations.test.mjs`
Expected: `workflow-policy: ok`, and the mutation count is four higher than after Task 5, with no `not caught:`.

Run the actionlint command from `ci.yml`, and `pnpm format:check`.
Expected: no output from actionlint, and formatting passes.

- [ ] **Step 5: Write the Sentry runbook**

In `docs/deployment.md`, insert after the `## Monitoring` section (before `## Opening sign-up (end of Plan 4)`):

````markdown
## Sentry

Errors from both apps go to Sentry's free Developer plan (spec §10 Monitoring, D50). Every event passes a scrubber that removes share, manage and email tokens and email addresses, and the SDKs collect nothing on their own: no cookies, headers, bodies or local variables. Only production reports. Previews, CI and local builds have no DSN.

### One-off setup

1. **Account and projects.** Create a Sentry account on the Developer plan, then two projects: `hanker-api` (platform Node.js) and `hanker-web` (platform Browser JavaScript).
2. **Privacy settings, in each project:** under Settings → Security & Privacy, keep **Data Scrubber** and **Use Default Scrubbers** on, and turn on **Prevent Storing of IP Addresses**.
3. **Alerts.** Keep the default alert rule that emails you on a new issue.
4. **The API's DSN:** copy `hanker-api`'s DSN (Settings → Client Keys), then set it on the API's Vercel production environment. The value goes through your clipboard, so it never appears in the terminal:
   ```bash
   vercel env add SENTRY_DSN production --cwd apps/api   # paste when prompted
   ```
5. **The web's DSN, and the names the upload needs.** DSNs are public by design, so these are variables, not secrets:
   ```bash
   gh variable set SENTRY_DSN_WEB      # hanker-web's DSN
   gh variable set SENTRY_ORG          # your organization slug
   gh variable set SENTRY_PROJECT_WEB  # hanker-web
   ```
6. **The upload token.** Create an organization auth token under Settings → Auth Tokens; its default scopes cover source-map uploads. Then:
   ```bash
   gh secret set SENTRY_AUTH_TOKEN --env production
   ```
7. **Redeploy.** Merge anything to `main`, or re-run the latest deploy. The API reads `SENTRY_DSN` at runtime, and the web DSN is inlined at build.

### Check it works

Open `https://hanker.dev` and run this in the browser console:

```js
setTimeout(() => { throw new Error('sentry check /c/AAAAAAAAAAAAAAAAAAAAAA') })
```

Within a minute, `hanker-web` has a new issue whose message reads `sentry check /c/[redacted]`, with a readable stack trace. That one event proves three things: the DSN is inlined, the CSP lets the report out, and the scrubber runs. There's no safe way to force a production API `500`, so the API's wiring is proven by its tests and by its first real error.

### Source maps

The production build emits browser source maps. The build job, which holds no secrets, writes debug IDs into them and moves them out of the deploy output into the `web-sourcemaps` artifact (`scripts/extract-sourcemaps.sh`), so `hanker.dev` never serves them; `scripts/check-vercel-output.sh` refuses to deploy one. The `sourcemaps` job uploads them with a checksum-pinned `sentry-cli`. Until `SENTRY_AUTH_TOKEN` is set, it skips the upload with a notice. No release waits on it. Both servers translate stack traces from their own deployed maps at runtime, so they need no upload.
````

Run: `pnpm format:check`
Expected: pass. If prettier reformats the new section, run `pnpm exec prettier --write docs/deployment.md` and check it only re-wrapped.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/deploy.yml scripts/workflow-policy.test.mjs scripts/workflow-policy.mutations.test.mjs docs/deployment.md
git commit -m "feat(ops): upload browser source maps to Sentry from a job no release waits on

Co-Authored-By: <the model that wrote this commit> <noreply@anthropic.com>"
```

---

### Task 8: Deterministic lock-holder tests

**Files:**
- Create: `apps/api/test/support/locks.ts`
- Modify: `apps/api/test/claims.int-spec.ts` (two tests)
- Modify: `apps/api/test/manage-claims.int-spec.ts` (two tests)

**Interfaces:**
- Produces: `untilBlockedBy(pool: Pool, holderPid: number, waiting: number, settled: Promise<unknown>, timeoutMs?: number): Promise<void>` from `test/support/locks.ts`.

**Why, and a bug this fixes.** Each test opens a transaction that holds a lock, starts requests that need it, and sleeps 300 ms hoping they've reached it before committing. That's flaky on a slow runner, and proves nothing on a fast one. The new helper waits until Postgres itself reports the requests waiting.

It also exposes a real bug. supertest sends nothing until `.then` is called, and "refuses the same token racing onto another item" builds its request with `const pending = claim(…)` and first awaits it **after** the commit. Its claim therefore runs against the committed row, gets its `409` from the ordinary lookup, and never reaches the unique index the test is named for. Starting the request with `.then((res) => res)` fixes it.

- [ ] **Step 1: Write the helper**

Create `apps/api/test/support/locks.ts`:

```ts
import type { Pool } from 'pg';

/**
 * Waits until `waiting` backends are blocked on a lock and at least one of them is blocked by
 * `holderPid`, so a lock-holder test commits only once its requests reached the lock (Plan 5b,
 * replacing fixed sleeps). Returns early if `settled` resolves first: an implementation that
 * doesn't take the lock lets the requests finish, and the test's own assertions then fail.
 * Integration files run serially against their own database, so no other test's backends count.
 */
export async function untilBlockedBy(
  pool: Pool,
  holderPid: number,
  waiting: number,
  settled: Promise<unknown>,
  timeoutMs = 10_000,
): Promise<void> {
  let done = false;
  void settled.then(
    () => (done = true),
    () => (done = true),
  );
  const deadline = Date.now() + timeoutMs;
  while (!done) {
    const { rows } = await pool.query<{ waiting: number; blocked: number }>(
      `select count(*) filter (where wait_event_type = 'Lock')::int as waiting,
              count(*) filter (where $1 = any(pg_blocking_pids(pid)))::int as blocked
         from pg_stat_activity
        where datname = current_database() and pid <> $1`,
      [holderPid],
    );
    const row = rows[0];
    if (row && row.waiting >= waiting && row.blocked >= 1) return;
    if (Date.now() > deadline)
      throw new Error(`timed out waiting for ${waiting} requests to block on pid ${holderPid}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
```

- [ ] **Step 2: Use it in the four tests, watching the fixed one fail first**

In each of the four tests, right after `await holder.query('begin');`, add:

```ts
      const holderPid = (await holder.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]!.pid;
```

Then make these changes, importing `untilBlockedBy` from `./support/locks.js` in both files:

1. **`claims.int-spec.ts`, "makes a claim wait for the item’s lock…":** replace the sleep and its comment with:
   ```ts
      // Every claim is waiting on the item's row lock, or behind one that is.
      await untilBlockedBy(db.pool, holderPid, 5, pending);
   ```
2. **`claims.int-spec.ts`, "refuses the same token racing onto another item…":**
   - change `const pending = claim(token, kettle, { claimerName: 'Sue', manageToken });` to `const pending = claim(token, kettle, { claimerName: 'Sue', manageToken }).then((res) => res);` and add above it the comment `// supertest sends nothing until .then: start the claim now, before the holder commits.`;
   - replace the sleep and its comment with `await untilBlockedBy(db.pool, holderPid, 1, pending);`.
3. **`manage-claims.int-spec.ts`, "…however long her PATCH had to wait for the lock" and "re-reads the claim under the lock…":** replace `await new Promise((resolve) => setTimeout(resolve, 300));` with:
   ```ts
      await untilBlockedBy(db.pool, holderPid, 1, patch);
   ```
   `patch` is assigned on the line before, so it's started.

**Prove the helper catches the bug before fixing it:**
1. Apply only change 2's helper line, leaving `pending` unstarted.
2. Run `cd apps/api && pnpm exec vitest run --project integration test/claims.int-spec.ts -t "racing onto another item"`.
3. Expected: FAIL with `timed out waiting for 1 requests to block on pid …`. The request never starts, so nothing ever waits.
4. Then add the `.then((res) => res)`.

- [ ] **Step 3: Run the two files, then the whole integration suite**

Run: `cd apps/api && pnpm exec vitest run --project integration test/claims.int-spec.ts test/manage-claims.int-spec.ts --reporter=verbose`
Expected: PASS, with all four tests listed as passing.

Run it five more times in a row (`for i in 1 2 3 4 5; do …; done`).
Expected: PASS every time.

Run: `pnpm test:integration && pnpm format:check && API_ORIGIN=http://localhost:3001 TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm turbo run lint typecheck`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/support/locks.ts apps/api/test/claims.int-spec.ts apps/api/test/manage-claims.int-spec.ts
git commit -m "test(api): wait for Postgres to report the lock, and start the race test's claim

Co-Authored-By: <the model that wrote this commit> <noreply@anthropic.com>"
```

---

### Task 9: Plan 5a's minors M1–M4

**Files:**
- Modify: `scripts/backup.sh`, `scripts/backup.test.sh` (M1)
- Modify: `docs/deployment.md` (M2, M3)
- Modify: `scripts/restore-drill.sh`, `scripts/restore-drill.test.sh` (M4)

- [ ] **Step 1 (M4): Write the failing drill tests**

In `scripts/restore-drill.test.sh`'s docker stub, add a failure switch for the TOC listing and one for a row count. Make the `pg_restore --list` branch start with `if [[ "${STUB_LIST_FAILS:-}" == 1 ]]; then exit 1; fi`, and the generic `count(*)` branch:

```bash
    if [[ "$args" == *"count(*)"* ]]; then
      if [[ "${STUB_COUNT_FAILS:-}" == 1 ]]; then exit 1; fi
      echo 7; exit 0
    fi
```

Add before the "Bad arguments" block:

```bash
# Plan 5a M4: every failure says "restore drill FAILED", and none is swallowed.
[[ $(run STUB_LIST_FAILS=1 "$dump" "$identity") != 0 ]] || fail "a failed table listing must fail"
grep -q 'restore drill FAILED' "$tmp/out" || fail "a failed table listing must say the drill FAILED"
[[ $(run STUB_COUNT_FAILS=1 "$dump" "$identity") != 0 ]] || fail "a failed row count must fail, not print a blank"
grep -q 'restore drill FAILED' "$tmp/out" || fail "a failed row count must say the drill FAILED"
removed || fail "a failed drill must still remove its container"
```

Run: `scripts/restore-drill.test.sh`
Expected: FAIL with `a failed table listing must say the drill FAILED`, because the script exits through `set -e` without the prefix.

- [ ] **Step 2 (M4): Give every step its `die`**

In `scripts/restore-drill.sh`:
- **The table listing:**
  ```bash
  listed=$(docker exec "$name" pg_restore --list /tmp/dump.pgc \
    | awk '$4 == "TABLE" && $5 == "public" { print $6 }' | LC_ALL=C sort) \
    || die "couldn't list the tables in $dump"
  ```
- **The restored tables:** `restored=$(sql "select tablename from pg_tables where schemaname = 'public'" | LC_ALL=C sort) || die "couldn't list the restored tables"`.
- **The migration count:** `migrations=$(sql 'select count(*) from drizzle.__drizzle_migrations') || die "the dump has no drizzle migrations table"`.
- **The row-count loop body:**
  ```bash
    rows=$(sql "select count(*) from public.\"$table\"") || die "couldn't count the rows in $table"
    printf '  %-24s %s\n' "$table" "$rows"
  ```

Run: `scripts/restore-drill.test.sh`
Expected: `restore-drill: ok`.

- [ ] **Step 3 (M1): Correct the argv comment and the test's wording**

In `scripts/backup.sh`, replace the comment above `docker run`:

```bash
# The URL reaches the container through its environment, so it's never on the runner's docker
# command line. Inside the container it's pg_dump's argument, visible only to that container.
# The plaintext exists only inside the pipe.
```

In `scripts/backup.test.sh`, change the message `"a secret reached a command line"` to `"a secret reached the runner's command line"`.

Run: `scripts/backup.test.sh`
Expected: `backup: ok`.

- [ ] **Step 4 (M2, M3): Make the runbook match reality**

In `docs/deployment.md` → Backups → "When it fails":
- **The `403` row:** change the symptom `` `403` from `r2.cloudflarestorage.com` `` to `` `curl: (22) The requested URL returned error: 403` ``.
- **The age row:** replace the `` `the dump isn't age-encrypted` `` row with two rows:
  ```markdown
  | `age: error: …` | `age` refused to encrypt, usually because `AGE_RECIPIENT` isn't a valid `age1…` public key. Set it again from your key pair. |
  | `the dump isn't age-encrypted` | `age` exited cleanly but wrote no header. That shouldn't happen; check the "Install age" step installed v1.3.2. |
  ```

In `docs/deployment.md`, Backups step 2:
- **Connecting:** replace the `read -rs OWNER_URL && psql "$OWNER_URL"; unset OWNER_URL` block with:
  ```bash
  psql 'postgresql://neondb_owner@<direct-host>/neondb?sslmode=require'   # psql prompts for the password
  ```
- **The sentence about the string:** after "using the direct (not `-pooler`) connection string from the Neon console", add "with the password removed, so psql prompts for it and it never appears in a process list".

In "Restore drill and recovery" → Real recovery step 4:
- **The block:** drop `read -rs OWNER_URL` and `unset OWNER_URL`, and replace `psql "$OWNER_URL"` with `psql 'postgresql://neondb_owner@<direct-host>/neondb?sslmode=require'`.
- **The sentence:** add "psql asks for the owner's password on the terminal even while its input is the pipe."

Run: `pnpm format:check`
Expected: pass. If prettier re-wraps a table, `pnpm exec prettier --write docs/deployment.md` and check the diff only realigned it.

- [ ] **Step 5: Commit**

```bash
git add scripts/backup.sh scripts/backup.test.sh scripts/restore-drill.sh scripts/restore-drill.test.sh docs/deployment.md
git commit -m "fix(ops): Plan 5a's minors: drill failures always say FAILED, docs match real output

Co-Authored-By: <the model that wrote this commit> <noreply@anthropic.com>"
```

---

### Task 10: `docs/operations.md`

**Files:**
- Create: `docs/operations.md`
- Modify: `AGENTS.md` ("Read first", and a Conventions bullet)
- Modify: `docs/superpowers/plans/2026-10-07-roadmap.md` (row 5b's status)

- [ ] **Step 1: Write the checklist**

Create `docs/operations.md`:

```markdown
# Operations

Running Hanker once it's live. Setup lives in [deployment.md](deployment.md); this is what to check, how often, and where to go when something breaks.

## Before inviting people widely

Do these once, and again after a big change to how the site runs.

- [ ] Better Stack's three monitors are green, and the backup heartbeat has reported ([Monitoring](deployment.md#monitoring)).
- [ ] A Better Stack test alert reaches your email (each monitor's menu → "Send test alert").
- [ ] A Sentry test event arrives with its token redacted ([Sentry → Check it works](deployment.md#check-it-works)). The API's wiring is proven by its tests and by its first real error; there's no safe way to force a production `500`.
- [ ] The restore drill has passed against a real nightly dump ([Restore drill and recovery](deployment.md#restore-drill-and-recovery)). It first passed on 2026-10-20.
- [ ] The runbooks in deployment.md match what you see in each dashboard.

## Recurring

| When | What | Where |
| --- | --- | --- |
| Weekly | Triage new Sentry issues: fix, ignore with a reason, or open an issue | Sentry → Issues |
| Weekly | Review and merge Renovate's PRs | GitHub → Pull requests |
| Monthly | Neon compute against the free quota (pause the Deep monitor past about 70%) | Neon → Usage; [Monitoring](deployment.md#monitoring) |
| Monthly | R2 bucket size, and that a dump arrived every night | Cloudflare → R2 → `hanker-backups` |
| Monthly | The monitors' and heartbeat's incident history | Better Stack |
| Quarterly | The restore drill (D53). Put a recurring reminder in your calendar | [Restore drill and recovery](deployment.md#restore-drill-and-recovery) |
| After a backup-path change | The restore drill: after a Postgres major upgrade, a new `age` key, a change to `backup.sh` or the backup role's grants, or a new pinned image | Same |
| Yearly | Rotate the R2 token and `hanker_backup`'s password | [Backups → Rotation and upgrades](deployment.md#rotation-and-upgrades) |
| Yearly | Check `hanker.dev` auto-renews, and how long Node's LTS has left | Cloudflare → Registrar; nodejs.org |

## When something breaks

| You see | Start here |
| --- | --- |
| Better Stack: Live or Site down | Vercel's status, then the latest deploy; roll back if it caused it ([Rollback](deployment.md#rollback)) |
| Better Stack: Deep down, Live up | Neon: its status page and the compute quota ([Monitoring](deployment.md#monitoring)) |
| Better Stack: backup heartbeat failed or missed | [Backups → When it fails](deployment.md#when-it-fails) |
| A Sentry issue | Its `requestId` tag matches the API's `x-request-id` and Vercel's logs, which keep only an hour |
| Bad data, newer than 6 hours | Neon point-in-time restore ([Rollback](deployment.md#rollback)) |
| Bad data, older than 6 hours | [Restore drill and recovery → Real recovery](deployment.md#restore-drill-and-recovery) |
| A deploy run failed | Its first red job's log; a stale-commit refusal from `assert-main-tip.sh` is by design ([Continuous deployment](deployment.md#continuous-deployment)) |
```

- [ ] **Step 2: Link it, and give future agents the reporting rule**

In `AGENTS.md` → "Read first" → "How to work here", add after the `docs/deployment.md` bullet:

```markdown
  - [docs/operations.md](docs/operations.md): the readiness checklist, recurring chores and where to start when something breaks.
```

In `AGENTS.md` → Conventions, after the "Personal data" bullet, add:

```markdown
- **Error reporting (Plan 5b):** report through the API's `ERROR_REPORTER` port or the web's `onRequestError`, never by calling Sentry directly, so every event passes `scrubEvent`. Never attach a request body, a URL, a user or a raw `DrizzleQueryError` (`reportable()` rebuilds it). `redactTokens` in `packages/contracts` is the one definition of what's redacted; a new token-bearing route must be covered by it, and its test.
```

In the roadmap, change row 5b's status from `Not started` to `Built; done when Sentry receives the go-live test event`.

- [ ] **Step 3: Check the links and formatting, then commit**

Run: `for a in monitoring check-it-works restore-drill-and-recovery rollback when-it-fails rotation-and-upgrades continuous-deployment; do printf '%s: ' $a; grep -c "^#\+ $(echo $a | sed 's/-/ /g')" -i docs/deployment.md; done`
Expected: every anchor has a matching heading (a count of at least 1).

Run: `pnpm format:check`
Expected: pass. If prettier re-wraps a table, apply it with `--write` and check the diff.

```bash
git add docs/operations.md AGENTS.md docs/superpowers/plans/2026-10-07-roadmap.md
git commit -m "docs: add the operations checklist: readiness, recurring chores, where to start

Co-Authored-By: <the model that wrote this commit> <noreply@anthropic.com>"
```

---

### Task 11: Go-live checkpoint (after Ted merges the stack)

Not a coding task. The controller stops after the stack is submitted. Ted merges it, then does steps 1–3 himself (AGENTS.md "Ask a maintainer first").

- [ ] **Step 1 (Ted): Set up Sentry**, following `docs/deployment.md` → Sentry → One-off setup, items 1–6.
- [ ] **Step 2 (Ted): Redeploy** (item 7), and check the run's `sourcemaps` job uploaded rather than skipped.
- [ ] **Step 3 (Ted): Send the browser test event** ("Check it works"), and tell the controller what the issue's message says.
- [ ] **Step 4 (controller): Verify what's visible without secrets.**
  ```bash
  curl -sI https://hanker.dev/ | grep -i content-security-policy        # connect-src lists the ingest origin
  curl -s -o /dev/null -w '%{http_code}\n' "https://hanker.dev/_next/static/chunks/$(curl -s https://hanker.dev/ | grep -o '_next/static/chunks/[^"]*\.js' | head -1 | xargs basename).map"   # 404: maps aren't served
  gh run list --workflow deploy.yml --limit 1
  ```
  Expected: `connect-src 'self' https://o….ingest….sentry.io`, a `404` for the map, and the run `completed success`.
- [ ] **Step 5 (controller): Record it.**
  - Mark roadmap row 5b Done, in a docs PR or the next plan's first layer.
  - Update this plan's memory file.
  - Remind Ted to put the quarterly drill in his calendar. The controller can create the recurring event through his calendar connection only if he asks.
