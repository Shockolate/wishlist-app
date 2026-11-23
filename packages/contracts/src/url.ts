/**
 * Parsing and shop hosts shared by `retailers.ts` and `links.ts`. Internal: not exported from the
 * package's index.
 */

export const AMAZON_HOSTS: ReadonlySet<string> = new Set(['amazon.com', 'www.amazon.com']);
export const ETSY_HOSTS: ReadonlySet<string> = new Set(['etsy.com', 'www.etsy.com']);
export const EBAY_HOSTS: ReadonlySet<string> = new Set(['ebay.com', 'www.ebay.com']);

/** A URL string, or anything that carries one, such as a `URL`. */
export type UrlLike = string | { readonly href: string };

export interface ParsedUrl {
  readonly protocol: string;
  readonly hostname: string;
  readonly pathname: string;
  readonly searchParams: { getAll(name: string): string[] };
}
/**
 * The runtime's WHATWG URL parser, so a host is read exactly as the browser and Node read it. This
 * package compiles without DOM or Node types (see `wishlist.ts`), so it names only what it uses.
 */
const WhatwgUrl = (globalThis as unknown as { URL: new (input: string) => ParsedUrl }).URL;

/** The parsed link, or null when it isn't one. Never throws. */
export function parse(url: UrlLike): ParsedUrl | null {
  try {
    return new WhatwgUrl(typeof url === 'string' ? url : url.href);
  } catch {
    return null;
  }
}
