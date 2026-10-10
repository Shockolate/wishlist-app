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
    await new MailpitEmailSender(baseUrl, 'Hanker <hanker@localhost>').send({
      to: 'ada@example.com',
      subject: 'Confirm your email',
      text: 'Plain body',
      html: '<p>Plain body</p>',
    });

    const res = await fetch(
      `${baseUrl}/api/v1/search?query=${encodeURIComponent('to:ada@example.com')}`,
    );
    const body = (await res.json()) as {
      messages: { Subject: string; From: { Address: string; Name: string } }[];
    };
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toMatchObject({
      Subject: 'Confirm your email',
      From: { Address: 'hanker@localhost', Name: 'Hanker' },
    });
  });
});
