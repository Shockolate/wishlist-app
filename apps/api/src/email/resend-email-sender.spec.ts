import { describe, expect, it } from 'vitest';
import { FakeErrorReporter } from '../testing/fakes.js';
import { ResendEmailSender } from './resend-email-sender.js';

const message = { to: 'ada@example.com', subject: 'Hi', text: 'Hello', html: '<p>Hello</p>' };

function fakeFetch(status: number, body = '{"id":"x"}', headers: Record<string, string> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(body, { status, headers }));
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function sender(fetch: ReturnType<typeof fakeFetch>, reporter = new FakeErrorReporter()) {
  return new ResendEmailSender('re_key', 'W <w@x.io>', reporter, fetch.fn);
}

const refusal = (send: Promise<void>) => send.catch((e: unknown) => e);

describe('ResendEmailSender', () => {
  it('posts the message to Resend with the API key as a bearer token', async () => {
    const { fn, calls } = fakeFetch(200);
    await new ResendEmailSender(
      're_key',
      'Hanker <no-reply@mail.hanker.dev>',
      new FakeErrorReporter(),
      fn,
    ).send(message);
    expect(calls[0]?.url).toBe('https://api.resend.com/emails');
    expect(new Headers(calls[0]?.init.headers).get('authorization')).toBe('Bearer re_key');
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      from: 'Hanker <no-reply@mail.hanker.dev>',
      to: ['ada@example.com'],
      subject: 'Hi',
      text: 'Hello',
      html: '<p>Hello</p>',
    });
  });

  it('rejects when Resend refuses, without putting the key in the error', async () => {
    const error = await refusal(sender(fakeFetch(422)).send(message));
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain('422');
    expect(String(error)).not.toContain('re_key');
  });

  describe('the free-plan quotas (D106)', () => {
    it("names Resend's error, so a quota cut-off reads differently from an outage", async () => {
      const body = JSON.stringify({
        statusCode: 429,
        name: 'daily_quota_exceeded',
        message: 'You have exceeded your daily email sending quota for ada@example.com.',
      });
      const error = await refusal(sender(fakeFetch(429, body)).send(message));
      expect((error as Error).message).toBe('Resend answered 429 daily_quota_exceeded');
    });

    it("keeps only the status when the error's name isn't a plain code", async () => {
      for (const body of ['not json', '{"name":"ada@example.com"}', '{"message":"no name"}']) {
        const error = await refusal(sender(fakeFetch(422, body)).send(message));
        expect((error as Error).message).toBe('Resend answered 422');
      }
    });

    it("warns once a send leaves the day's quota 80% used", async () => {
      const reporter = new FakeErrorReporter();
      await sender(fakeFetch(200, undefined, { 'x-resend-daily-quota': '79' }), reporter).send(
        message,
      );
      expect(reporter.warnings).toEqual([]);
      await sender(fakeFetch(200, undefined, { 'x-resend-daily-quota': '80' }), reporter).send(
        message,
      );
      expect(reporter.warnings).toEqual([{ message: 'resend daily quota 80% used' }]);
    });

    it("warns once a send leaves the month's quota 80% used", async () => {
      const reporter = new FakeErrorReporter();
      await sender(fakeFetch(200, undefined, { 'x-resend-monthly-quota': '2399' }), reporter).send(
        message,
      );
      expect(reporter.warnings).toEqual([]);
      await sender(fakeFetch(200, undefined, { 'x-resend-monthly-quota': '2400' }), reporter).send(
        message,
      );
      expect(reporter.warnings).toEqual([{ message: 'resend monthly quota 80% used' }]);
    });

    it('warns about nothing when the headers are missing or not counts', async () => {
      const reporter = new FakeErrorReporter();
      await sender(fakeFetch(200), reporter).send(message);
      await sender(
        fakeFetch(200, undefined, { 'x-resend-daily-quota': '9e9', 'x-resend-monthly-quota': '' }),
        reporter,
      ).send(message);
      expect(reporter.warnings).toEqual([]);
    });
  });
});
