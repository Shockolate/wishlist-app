const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';

export interface MailSummary {
  ID: string;
  Subject: string;
}

/** Every email Mailpit holds for an address, newest first. */
export async function emailsTo(address: string): Promise<MailSummary[]> {
  const res = await fetch(
    `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`,
  );
  if (!res.ok) throw new Error(`Mailpit search answered ${res.status}`);
  return ((await res.json()) as { messages: MailSummary[] }).messages;
}

/** The newest email with this subject, once it arrives. Mail goes out in the background. */
export async function waitForEmail(
  address: string,
  subject: string,
  timeoutMs = 15_000,
): Promise<{ text: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = (await emailsTo(address)).find((m) => m.Subject === subject);
    if (match) {
      const res = await fetch(`${MAILPIT}/api/v1/message/${match.ID}`);
      if (!res.ok) throw new Error(`Mailpit message ${match.ID} answered ${res.status}`);
      return { text: ((await res.json()) as { Text: string }).Text };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no "${subject}" email to ${address} within ${timeoutMs} ms`);
}

/** The path and query of the emailed link to `path`, ready for page.goto. */
export function linkPath(text: string, path: string): string {
  const match = new RegExp(`https?://\\S+?(${path}\\?token=[A-Za-z0-9_-]{43})`).exec(text);
  if (!match?.[1]) throw new Error(`no ${path} link in this email`);
  return match[1];
}
