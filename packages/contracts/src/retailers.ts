/**
 * Shops whose links are looked up through a service instead of fetched (retailer lookups design
 * §5.1). The web uses this to choose the waiting state; the API uses it to route the lookup.
 */
export type Retailer = 'amazon' | 'etsy' | 'ebay';

const AMAZON_HOSTS = new Set(['amazon.com', 'www.amazon.com']);
const AMAZON_SHORT_HOSTS = new Set(['amzn.to', 'a.co']);
/** An ASIN after /dp/ or /gp/product/, anywhere in the path: slugs and language prefixes come first. */
const ASIN_IN_PATH = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i;

const ETSY_HOSTS = new Set(['etsy.com', 'www.etsy.com']);
const ETSY_SHORT_HOST = 'etsy.me';
/**
 * `/listing/<id>` at the path's start, after at most one locale segment (`/uk/`, `/en-gb/`). The ID
 * is positive and at most 18 digits, so it always fits Etsy's int64 (Plan 8b ruling 1).
 */
const LISTING_IN_PATH = /^(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/listing\/([1-9]\d{0,17})(?:\/|$)/i;

const EBAY_HOSTS = new Set(['ebay.com', 'www.ebay.com']);
/**
 * `/itm/<number>` at the path's start, with an optional slug between. The number is positive and 9
 * to 15 digits, so it always fits eBay's 64-bit item numbers (eBay lookups §5.1).
 */
const ITEM_IN_PATH = /^\/itm\/(?:[^/]+\/)?([1-9]\d{8,14})(?:\/|$)/;
/** The `?var=` option number: positive, 6 to 15 digits. */
const OPTION_NUMBER = /^[1-9]\d{5,14}$/;

/** A URL string, or anything that carries one, such as a `URL`. */
export type UrlLike = string | { readonly href: string };

interface ParsedUrl {
  readonly hostname: string;
  readonly pathname: string;
  readonly searchParams: { getAll(name: string): string[] };
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

/** The listing ID of an etsy.com listing link, or null for any other link. Never throws. */
export function etsyListingOf(url: UrlLike): { listingId: string } | null {
  const parsed = parse(url);
  if (!parsed || !ETSY_HOSTS.has(parsed.hostname)) return null;
  const listingId = LISTING_IN_PATH.exec(parsed.pathname)?.[1];
  return listingId ? { listingId } : null;
}

/** An Etsy short link, which has to be followed before its listing is known. */
export function isEtsyShortLink(url: UrlLike): boolean {
  return parse(url)?.hostname === ETSY_SHORT_HOST;
}

/**
 * The item number of an ebay.com item link, and the option number when the link names exactly one
 * valid `?var=` (otherwise it is left out, not an error). Null for any other link. Never throws.
 */
export function ebayItemOf(url: UrlLike): { itemId: string; variationId?: string } | null {
  const parsed = parse(url);
  if (!parsed || !EBAY_HOSTS.has(parsed.hostname)) return null;
  const itemId = ITEM_IN_PATH.exec(parsed.pathname)?.[1];
  if (!itemId) return null;
  const options = parsed.searchParams.getAll('var');
  const [option] = options;
  return options.length === 1 && option !== undefined && OPTION_NUMBER.test(option)
    ? { itemId, variationId: option }
    : { itemId };
}

/** The shop a link is looked up through, or null when it takes the page fetch. */
export function retailerOf(url: string): Retailer | null {
  if (amazonProductOf(url) || isAmazonShortLink(url)) return 'amazon';
  if (etsyListingOf(url) || isEtsyShortLink(url)) return 'etsy';
  if (ebayItemOf(url)) return 'ebay';
  return null;
}

/** What Bright Data is sent: the product alone, never the pasted link's tracking or search terms. */
export function amazonProductUrl(asin: string): string {
  return `https://www.amazon.com/dp/${asin}`;
}
