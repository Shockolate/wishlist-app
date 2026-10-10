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
    await new ResendEmailSender('re_key', 'Hanker <no-reply@mail.hanker.dev>', fn).send(message);
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
    const { fn } = fakeFetch(422);
    const error: unknown = await new ResendEmailSender('re_key', 'W <w@x.io>', fn)
      .send(message)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain('422');
    expect(String(error)).not.toContain('re_key');
  });
});
