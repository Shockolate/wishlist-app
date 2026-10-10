import { describe, expect, it } from 'vitest';
import { MailpitEmailSender } from './mailpit-email-sender.js';

describe('MailpitEmailSender', () => {
  it("speaks Mailpit's send API, with its capitalized field names", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fn = ((url: URL, init: RequestInit) => {
      calls.push({ url: url.toString(), init });
      return Promise.resolve(new Response('{"ID":"1"}', { status: 200 }));
    }) as unknown as typeof fetch;
    await new MailpitEmailSender('http://localhost:8025', 'Hanker <hanker@localhost>', fn).send({
      to: 'ada@example.com',
      subject: 'Hi',
      text: 'Hello',
      html: '<p>Hello</p>',
    });
    expect(calls[0]?.url).toBe('http://localhost:8025/api/v1/send');
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      From: { Email: 'hanker@localhost', Name: 'Hanker' },
      To: [{ Email: 'ada@example.com' }],
      Subject: 'Hi',
      Text: 'Hello',
      HTML: '<p>Hello</p>',
    });
  });
});
