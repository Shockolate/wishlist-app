import { DESCRIPTION_MAX, visibleOnly } from '@wishlist/contracts';
import { Parser } from 'htmlparser2';

/**
 * What a page says about the product on it. Every field is optional (spec §6.8). The description
 * is for tag suggestions only (Plan 9): it never counts as a prefill by itself, and it is never set
 * from Etsy (D69).
 */
export interface PageMetadata {
  title?: string;
  imageUrl?: string;
  priceText?: string;
  description?: string;
}

const TITLE_MAX = 200;
const PRICE_MAX = 50;
const URL_MAX = 2048;

/** Intl formats an unknown but well-formed code ("ABC") as "ABC 24.99", so only known codes go to it. */
const KNOWN_CURRENCIES = new Set(Intl.supportedValuesOf('currency'));

type JsonObject = Record<string, unknown>;

/**
 * What a product page says about itself (spec §6.8). Each field comes from the first source that
 * has it: Open Graph tags, then a JSON-LD Product, then <title> (Plan 3a rule 11). A title that is
 * only the site's name doesn't count. The description comes from og:description, then the JSON-LD
 * Product, then <meta name="description"> (tag suggestions design §5.3).
 */
export function extractMetadata(html: string, pageUrl: URL): PageMetadata {
  const page = scan(html);
  const product = findProduct(page.jsonLd);

  const siteNames = siteNamesOf(page.meta.get('og:site_name'), pageUrl);
  const title = [text(page.meta.get('og:title')), jsonText(product?.name), text(page.title)].find(
    (candidate) => candidate !== undefined && !siteNames.has(candidate.toLowerCase()),
  );
  const imageUrl = [
    page.meta.get('og:image:secure_url'),
    page.meta.get('og:image'),
    ...imagesOf(product),
  ]
    .map((candidate) => httpsUrl(candidate, pageUrl))
    .find((url) => url !== undefined);
  const priceText =
    formatPrice(
      page.meta.get('product:price:amount') ?? page.meta.get('og:price:amount'),
      page.meta.get('product:price:currency') ?? page.meta.get('og:price:currency'),
    ) ?? offerPrice(product);

  const description = [
    text(page.meta.get('og:description')),
    jsonText(product?.description),
    // `meta` is keyed by `property ?? name`, so this is <meta name="description">.
    text(page.meta.get('description')),
  ].find((candidate) => candidate !== undefined);

  return assemble(title, imageUrl, priceText, description);
}

/**
 * A lookup service's answer, cleaned exactly as a page's is (retailer lookups §5.2): visible text
 * only, titles cut to 200, https images, a display price, and a description cut to `DESCRIPTION_MAX`.
 * A field that isn't a string is dropped.
 */
export function productMetadata(
  fields: {
    title?: unknown;
    imageUrl?: unknown;
    amount?: unknown;
    currency?: unknown;
    description?: unknown;
  },
  base: URL,
): PageMetadata {
  return assemble(
    typeof fields.title === 'string' ? text(fields.title) : undefined,
    httpsUrl(fields.imageUrl, base),
    formatPrice(fields.amount, fields.currency),
    typeof fields.description === 'string' ? text(fields.description) : undefined,
  );
}

function assemble(
  title?: string,
  imageUrl?: string,
  priceText?: string,
  description?: string,
): PageMetadata {
  const metadata: PageMetadata = {};
  if (title) metadata.title = truncate(title, TITLE_MAX);
  if (imageUrl) metadata.imageUrl = imageUrl;
  if (priceText) metadata.priceText = priceText;
  if (description) metadata.description = truncate(description, DESCRIPTION_MAX);
  return metadata;
}

/**
 * A display price (spec §2: prices are strings), such as "$24.99", in visible characters only, as
 * the price contract requires (D36). When the amount isn't a plain number or the currency isn't one
 * Intl knows, it reads "<amount> <CODE>". Over 50 characters, it's dropped.
 */
export function formatPrice(amount: unknown, currency: unknown): string | undefined {
  const value =
    typeof amount === 'number' ? String(amount) : typeof amount === 'string' ? text(amount) : '';
  if (!value) return undefined;
  const code = typeof currency === 'string' ? (text(currency)?.toUpperCase() ?? '') : '';
  let formatted = code ? `${value} ${code}` : value;
  if (KNOWN_CURRENCIES.has(code) && /^\d+(\.\d+)?$/.test(value)) {
    try {
      formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(
        Number(value),
      );
    } catch {
      // Belt and braces: KNOWN_CURRENCIES should rule this out. Keep "<amount> <CODE>".
    }
  }
  return formatted.length <= PRICE_MAX ? formatted : undefined;
}

/** One pass over the page: its <meta> tags, its JSON-LD blocks and its first <title>. */
function scan(html: string): { meta: Map<string, string>; jsonLd: string[]; title?: string } {
  const meta = new Map<string, string>();
  const jsonLd: string[] = [];
  let title: string | undefined;
  let svgDepth = 0;
  let inTitle = false;
  let inJsonLd = false;
  let buffer = '';

  const parser = new Parser(
    {
      onopentag(name, attribs) {
        if (name === 'svg') svgDepth++;
        else if (name === 'meta') {
          const key = (attribs.property ?? attribs.name)?.trim().toLowerCase();
          if (key && attribs.content !== undefined && !meta.has(key))
            meta.set(key, attribs.content);
        } else if (
          name === 'script' &&
          attribs.type?.trim().toLowerCase() === 'application/ld+json'
        ) {
          inJsonLd = true;
          buffer = '';
        } else if (name === 'title' && svgDepth === 0 && title === undefined) {
          inTitle = true;
          buffer = '';
        }
      },
      // Text arrives in pieces, so it's accumulated until the element closes.
      ontext(chunk) {
        if (inJsonLd || inTitle) buffer += chunk;
      },
      onclosetag(name) {
        if (name === 'svg') svgDepth = Math.max(0, svgDepth - 1);
        else if (name === 'script' && inJsonLd) {
          jsonLd.push(buffer);
          inJsonLd = false;
        } else if (name === 'title' && inTitle) {
          title = buffer;
          inTitle = false;
        }
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  return { meta, jsonLd, title };
}

/**
 * The site's own names, lower-cased: its og:site_name and its host without "www.". A title that
 * says only one of these names the site, not the product, as a bot check's page does ("Amazon.com").
 */
function siteNamesOf(siteName: string | undefined, pageUrl: URL): Set<string> {
  const names = new Set([pageUrl.hostname.replace(/^www\./, '')]);
  const named = text(siteName);
  if (named) names.add(named.toLowerCase());
  return names;
}

/** The first schema.org Product in any JSON-LD block, looking inside arrays and @graph. */
function findProduct(blocks: string[]): JsonObject | undefined {
  for (const block of blocks) {
    let data: unknown;
    try {
      data = JSON.parse(block);
    } catch {
      continue;
    }
    const product = search(data, 0);
    if (product) return product;
  }
  return undefined;
}

function search(node: unknown, depth: number): JsonObject | undefined {
  if (depth > 8) return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = search(child, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (!isObject(node)) return undefined;
  if (typesOf(node['@type']).includes('product')) return node;
  return search(node['@graph'], depth + 1);
}

function typesOf(type: unknown): string[] {
  return (Array.isArray(type) ? type : [type])
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.toLowerCase().replace(/^https?:\/\/schema\.org\//, ''));
}

function imagesOf(product: JsonObject | undefined): unknown[] {
  if (!product) return [];
  const images: unknown[] = Array.isArray(product.image) ? product.image : [product.image];
  return images.map((entry) => (isObject(entry) ? (entry.url ?? entry.contentUrl) : entry));
}

function offerPrice(product: JsonObject | undefined): string | undefined {
  if (!product) return undefined;
  const offers = Array.isArray(product.offers) ? product.offers : [product.offers];
  for (const offer of offers) {
    if (!isObject(offer)) continue;
    const price = formatPrice(offer.price ?? offer.lowPrice, offer.priceCurrency);
    if (price) return price;
  }
  return undefined;
}

/** An image URL as gifters will load it: resolved against the page, https only (spec §2). */
function httpsUrl(candidate: unknown, base: URL): string | undefined {
  if (typeof candidate !== 'string' || !candidate.trim()) return undefined;
  try {
    const url = new URL(candidate.trim(), base);
    return url.protocol === 'https:' && url.href.length <= URL_MAX ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Well-formed UTF-16 with the control characters that aren't whitespace removed. NUL is the one
 * Postgres refuses; the rest are invisible, and a prefill is stored as it is shown.
 */
function withoutControls(value: string): string {
  return value.toWellFormed().replace(/(?!\s)\p{Cc}/gu, '');
}

/** Format characters (bidirectional overrides, zero-width spaces) except the two joiners (D35). */
const HIDDEN_FORMAT = /(?![\u200C\u200D])\p{Cf}/gu;

/**
 * A title, a description, or a price's amount or currency, as the item contract accepts it (D35,
 * D36): visible characters only, whitespace collapsed and trimmed. Empty, or nothing visible, is
 * "nothing".
 */
function text(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const collapsed = withoutControls(value.replace(HIDDEN_FORMAT, '')).replace(/\s+/g, ' ').trim();
  return collapsed && visibleOnly(collapsed) ? collapsed : undefined;
}

/** A JSON-LD string: <script> text isn't entity-decoded, so the basic entities are decoded here. */
function jsonText(value: unknown): string | undefined {
  return typeof value === 'string' ? text(decodeEntities(value)) : undefined;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity: string) => {
    const name = entity.toLowerCase();
    if (name.startsWith('#x')) return codePoint(parseInt(name.slice(2), 16)) ?? match;
    if (name.startsWith('#')) return codePoint(parseInt(name.slice(1), 10)) ?? match;
    return NAMED_ENTITIES[name] ?? match;
  });
}

/** A surrogate has no character of its own, so it becomes U+FFFD, as HTML does. */
function codePoint(n: number): string | undefined {
  if (!Number.isInteger(n) || n <= 0 || n > 0x10ffff) return undefined;
  return n >= 0xd800 && n <= 0xdfff ? '\uFFFD' : String.fromCodePoint(n);
}

/** At most `max` UTF-16 units, never ending on half of a surrogate pair. */
function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  let cut = value.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut.trimEnd();
}
