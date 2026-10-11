import type { ComponentProps } from 'react';

/**
 * A link that loads the next page from the server instead of swapping it in client-side. Use it
 * wherever the destination needs a different CSP from the page it is on: the policy belongs to
 * the document, so a client-side move onto a Turnstile page keeps the old one and Cloudflare's
 * frame is blocked (rule 6).
 */
export function DocumentLink(props: ComponentProps<'a'>) {
  return <a {...props} />;
}
