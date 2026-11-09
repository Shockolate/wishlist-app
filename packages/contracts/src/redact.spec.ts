import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { EmailSchema } from './auth.js';
import { CAPABILITY_TOKEN_PATTERN, EMAIL_PATTERN, EMAIL_TOKEN_PATTERN } from './patterns.js';
import { redactDeep, redactTokens } from './redact.js';

const CAPABILITY = 'AbCdEfGhIjKlMnOpQrStUv'; // 22 base64url characters
const EMAIL_TOKEN = 'a'.repeat(43);

describe('redactTokens', () => {
  it.each([
    ['a share page', `https://hanker.dev/s/${CAPABILITY}`, 'https://hanker.dev/s/[redacted]'],
    ['a manage page with a query', `/c/${CAPABILITY}?x=1`, '/c/[redacted]?x=1'],
    [
      'a shared API path',
      `/api/shared/${CAPABILITY}/items/3f1c`,
      '/api/shared/[redacted]/items/3f1c',
    ],
    [
      'a share preview photo API path (Plan 12)',
      `/api/shared/${CAPABILITY}/photos/3f1c2b7a-9d4e-4f60-8a1b-2c3d4e5f6a7b`,
      '/api/shared/[redacted]/photos/3f1c2b7a-9d4e-4f60-8a1b-2c3d4e5f6a7b',
    ],
    [
      'a share preview image (Plan 12)',
      `https://hanker.dev/s/${CAPABILITY}/preview.jpg`,
      'https://hanker.dev/s/[redacted]/preview.jpg',
    ],
    [
      'a ContractMismatchError message',
      `Response from /claims/${CAPABILITY} does not match its contract`,
      'Response from /claims/[redacted] does not match its contract',
    ],
    [
      'a token query parameter',
      '/verify-email?token=abc_DEF-123&next=/list',
      '/verify-email?token=[redacted]&next=/list',
    ],
    ['an email token anywhere', `token ${EMAIL_TOKEN} used`, 'token [redacted] used'],
    [
      'an email address',
      'mail to ada.lovelace+gifts@example.co.uk failed',
      'mail to [email] failed',
    ],
  ])('redacts %s', (_label, input, expected) => {
    expect(redactTokens(input)).toBe(expected);
  });

  it.each([
    [
      'a pnpm path that looks like an email',
      'at /var/task/node_modules/.pnpm/@sentry+node@11.8.0/node_modules/@sentry/node/build/esm/index.js:3:9',
    ],
    [
      'an ordinary stack frame',
      'at ClaimsService.claim (/var/task/apps/api/src/claims/claims.service.js:42:11)',
    ],
    ['an API route pattern', '/api/claims/:manageToken'],
    ['a web route pattern', '/c/[manageToken]'],
    ['a segment that is too long to be a token', `/c/${CAPABILITY}W`],
  ])('leaves %s alone', (_label, input) => {
    expect(redactTokens(input)).toBe(input);
  });

  // Whatever sign-up accepts as an address must be redacted whole, not just its tail.
  it.each([
    'ada@example.com',
    'Ada.Lovelace@Example.COM',
    "ann.o'brien@example.com",
    'first_last+tag@mail.example.co.uk',
    'x-y@ex-ample.io',
  ])('redacts all of %s, an address EmailSchema accepts', (address) => {
    expect(EmailSchema.safeParse(address).success).toBe(true);
    expect(redactTokens(`mail to ${address}.`)).toBe('mail to [email].');
  });
});

describe('redactTokens, where an address meets a token (found by the idempotence property)', () => {
  it('redacts an email token right after an address', () => {
    // The address ends at its TLD, `Aa`; the 43 characters after it are an email token only once
    // the address is gone, so addresses are redacted before email tokens.
    const token = '---_aA_aAA-A_000A__0a_0_a--_0-A-a_0__-_a_a_';
    expect(token).toMatch(EMAIL_TOKEN_PATTERN);
    expect(redactTokens(`+@a.Aa${token}`)).toBe('[email][redacted]');
  });

  it('redacts a query token that starts with a quoted address', () => {
    expect(redactTokens("?token='a.0@a.Aa")).toBe('?token=[redacted]');
  });
});

describe('redactTokens on long text', () => {
  // Every Sentry event's strings pass through here, so no input may make it slow. A quadratic scan
  // takes seconds on 50,000 characters; a linear one, tens of milliseconds.
  const LENGTH = 50_000;
  const fill = (unit: string) => unit.repeat(Math.ceil(LENGTH / unit.length)).slice(0, LENGTH);
  it.each([
    ['letters', fill('a')],
    ['letters and dots', fill('a.')],
    ['letters and dashes', fill('a-')],
    ['a long run, then @', `${fill('a')}@`],
    ['@, then a long domain', `a@${fill('a-')}`],
    ['many @ far apart', fill(`${'a'.repeat(300)}@`)],
  ])('takes linear time on %s', (_, text) => {
    const start = Date.now();
    redactTokens(text);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('still redacts the longest address EmailSchema accepts whole', () => {
    const address = `${'a'.repeat(242)}@example.com`;
    expect(address).toHaveLength(254);
    expect(EmailSchema.safeParse(address).success).toBe(true);
    expect(redactTokens(`<${address}>`)).toBe('<[email]>');
  });

  it('redacts only the last 254 characters of a longer run before an @', () => {
    expect(redactTokens(`${'a'.repeat(300)}@example.com`)).toBe(`${'a'.repeat(46)}[email]`);
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
    const output = redactDeep(input);
    expect(input.path).toBe(`/c/${CAPABILITY}`);
    expect(output.path).toBe('/c/[redacted]');
    expect(output.self).toBe(output);
  });
});

// Property tests (fast-check): a token or address planted in arbitrary text, at the boundaries
// redaction depends on.
const capabilityToken = fc.stringMatching(CAPABILITY_TOKEN_PATTERN);
const emailToken = fc.stringMatching(EMAIL_TOKEN_PATTERN);
const emailAddress = fc.stringMatching(EMAIL_PATTERN);
/** Text built from the pieces redaction looks for, so they meet far more often than at random. */
const text = fc
  .array(
    fc.oneof(
      capabilityToken,
      emailToken,
      emailAddress,
      fc.constantFrom('/s/', '/c/', '/shared/', '/claims/', '?token=', '&token=', '@', '.', '-'),
      fc.constantFrom(' ', '/', '#', '"', '[redacted]', '[email]'),
      fc.string({ maxLength: 8 }),
    ),
    { maxLength: 10 },
  )
  .map((pieces) => pieces.join(''));
/** A character no token or address contains, so whatever follows it can't extend one. */
const stop = fc.constantFrom(' ', '"', "'", '<', '>', '#', '?', '/', ',', '\n');
/** The end of the text, or a stop and then anything. */
const tail = fc.oneof(
  fc.constant(''),
  fc.tuple(stop, fc.string()).map(([s, rest]) => s + rest),
);
/** The start of the text, or anything and then a stop. */
const head = fc.oneof(
  fc.constant(''),
  fc.tuple(fc.string(), stop).map(([rest, s]) => rest + s),
);

describe('redactTokens properties', () => {
  it('leaves nothing that a second pass would redact', () => {
    fc.assert(
      fc.property(text, (input) => {
        const once = redactTokens(input);
        expect(redactTokens(once)).toBe(once);
      }),
    );
  });

  it('removes a share or manage token from every route that carries one', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.constantFrom('s', 'c', 'shared', 'claims'),
        capabilityToken,
        tail,
        (before, route, token, after) => {
          fc.pre(!before.includes(token) && !after.includes(token));
          expect(redactTokens(`${before}/${route}/${token}${after}`)).not.toContain(token);
        },
      ),
    );
  });

  it('removes an email token wherever it stands alone', () => {
    fc.assert(
      fc.property(head, emailToken, tail, (before, token, after) => {
        fc.pre(!before.includes(token) && !after.includes(token));
        expect(redactTokens(`${before}${token}${after}`)).not.toContain(token);
      }),
    );
  });

  it('removes every address EmailSchema accepts, whatever comes before it', () => {
    fc.assert(
      fc.property(fc.string(), emailAddress, tail, (before, address, after) => {
        fc.pre(EmailSchema.safeParse(address).success);
        fc.pre(!before.includes(address) && !after.includes(address));
        expect(redactTokens(`${before}${address}${after}`)).not.toContain(address);
      }),
    );
  });
});
