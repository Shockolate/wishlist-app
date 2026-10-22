/**
 * Shops whose links are looked up through a service instead of fetched (retailer lookups design
 * §5.1). The web uses this to choose the waiting state; the API uses it to route the lookup.
 */
export type Retailer = 'amazon';

const AMAZON_HOSTS = new Set(['amazon.com', 'www.amazon.com']);
const AMAZON_SHORT_HOSTS = new Set(['amzn.to', 'a.co']);
/** An ASIN after /dp/ or /gp/product/, anywhere in the path: slugs and language prefixes come first. */
const ASIN_IN_PATH = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i;

/** A URL string, or anything that carries one, such as a `URL`. */
export type UrlLike = string | { readonly href: string };

interface ParsedUrl {
  readonly hostname: string;
  readonly pathname: string;
}
/**
 * The runtime's WHATWG URL parser, so a host is read exactly as the browser and Node read it. This
 * package compiles without DOM or Node types (see `wishlist.ts`), so it names only what it uses.
 */
const WhatwgUrl = (globalThis as unknown as { URL: new (input: string) => ParsedUrl }).URL;

function parse(url: UrlLike): ParsedUrl | null {
  try {
    return new WhatwgUrl(typeof url === 'string' ? url : url.href);
  } catch {
    return null;
  }
}

/** The ASIN of an amazon.com product link, or null for any other link. Never throws. */
export function amazonProductOf(url: UrlLike): { asin: string } | null {
  const parsed = parse(url);
  if (!parsed || !AMAZON_HOSTS.has(parsed.hostname)) return null;
  const asin = ASIN_IN_PATH.exec(parsed.pathname)?.[1];
  return asin ? { asin: asin.toUpperCase() } : null;
}

/** An Amazon short link, which has to be followed before its product is known. */
export function isAmazonShortLink(url: UrlLike): boolean {
  const parsed = parse(url);
  return parsed !== null && AMAZON_SHORT_HOSTS.has(parsed.hostname);
}

/** The shop a link is looked up through, or null when it takes the page fetch. */
export function retailerOf(url: string): Retailer | null {
  return amazonProductOf(url) || isAmazonShortLink(url) ? 'amazon' : null;
}

/** What Bright Data is sent: the product alone, never the pasted link's tracking or search terms. */
export function amazonProductUrl(asin: string): string {
  return `https://www.amazon.com/dp/${asin}`;
}
