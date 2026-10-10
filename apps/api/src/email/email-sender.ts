export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Port for outgoing email (spec §8). `send` rejects when delivery fails. */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export const EMAIL_SENDER = Symbol('EMAIL_SENDER');

/** Splits the EMAIL_FROM format, `Name <address>`, for APIs that want the parts separately. */
export function parseAddress(value: string): { name: string; email: string } {
  const match = /^(.+?)\s*<([^<>\s]+)>$/.exec(value);
  if (!match?.[1] || !match[2]) throw new Error('expected "Name <address@domain>"');
  return { name: match[1], email: match[2] };
}
