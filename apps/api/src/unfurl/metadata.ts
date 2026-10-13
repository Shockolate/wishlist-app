import { Parser } from 'htmlparser2';

/** What a page says about the product on it. Every field is optional (spec §6.8). */
export interface PageMetadata {
  title?: string;
  imageUrl?: string;
  priceText?: string;
}

const TITLE_MAX = 200;
const PRICE_MAX = 50;
const URL_MAX = 2048;

type JsonObject = Record<string, unknown>;

/**
 * What a product page says about itself (spec §6.8). Each field comes from the first source that
 * has it: Open Graph tags, then a JSON-LD Product, then <title> (Plan 3a rule 11).
 */
export function extractMetadata(html: string, pageUrl: URL): PageMetadata {
  const page = scan(html);
  const product = findProduct(page.jsonLd);

  const title = text(page.meta.get('og:title')) ?? jsonText(product?.name) ?? text(page.title);
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

  const metadata: PageMetadata = {};
  if (title) metadata.title = truncate(title, TITLE_MAX);
  if (imageUrl) metadata.imageUrl = imageUrl;
  if (priceText) metadata.priceText = priceText;
  return metadata;
}

/**
 * A display price (spec §2: prices are strings), such as "$24.99". When the amount isn't a plain
 * number or the currency isn't one Intl knows, it reads "<amount> <CODE>". Over 50 characters,
 * it's dropped.
 */
export function formatPrice(amount: unknown, currency: unknown): string | undefined {
  const value =
    typeof amount === 'number' ? String(amount) : typeof amount === 'string' ? amount.trim() : '';
  if (!value) return undefined;
  const code = typeof currency === 'string' ? currency.trim().toUpperCase() : '';
  let formatted = code ? `${value} ${code}` : value;
  if (code && /^\d+(\.\d+)?$/.test(value)) {
    try {
      formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(
        Number(value),
      );
    } catch {
      // A malformed currency code: keep "<amount> <CODE>".
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

/** Whitespace collapsed and trimmed. Empty is "nothing". */
function text(value: string | undefined): string | undefined {
  const collapsed = value?.replace(/\s+/g, ' ').trim();
  return collapsed || undefined;
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

function codePoint(n: number): string | undefined {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : undefined;
}

/** At most `max` UTF-16 units, never ending on half of a surrogate pair. */
function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  let cut = value.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut.trimEnd();
}
