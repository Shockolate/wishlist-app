import 'server-only';
import { headers } from 'next/headers';

/** This request's CSP nonce, set by the proxy, for scripts a page adds itself (Turnstile). */
export async function cspNonce(): Promise<string | undefined> {
  return (await headers()).get('x-nonce') ?? undefined;
}
