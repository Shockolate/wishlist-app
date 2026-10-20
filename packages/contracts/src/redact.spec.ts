import { describe, expect, it } from 'vitest';
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
