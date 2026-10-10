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
