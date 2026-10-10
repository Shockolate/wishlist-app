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
