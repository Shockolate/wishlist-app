import type { LookupResult } from './lookup-result.js';
import { productMetadata } from './metadata.js';

/**
 * The eBay lookup port (eBay lookups §5.2). `ref` is `ebayRef`'s string: the item number, and the
 * option number when the pasted link named one. Never throws.
 */
export interface EbayLookup {
  lookUp(ref: string, signal: AbortSignal): Promise<LookupResult>;
}

/** The item number, and the option number from the link's `?var=` when it had one. */
export interface EbayItem {
  itemId: string;
  variationId?: string;
}

/** The router hands each lookup one string (Plan 15 ruling 1): `<item>` or `<item>:<option>`. */
export function ebayRef({ itemId, variationId }: EbayItem): string {
  return variationId ? `${itemId}:${variationId}` : itemId;
}

export function parseEbayRef(ref: string): EbayItem {
  const [itemId = '', variationId] = ref.split(':');
  return variationId ? { itemId, variationId } : { itemId };
}

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const ITEM_URL = 'https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id';
const GROUP_URL = 'https://api.ebay.com/buy/browse/v1/item/get_items_by_item_group';
const SCOPE = 'https://api.ebay.com/oauth/api_scope';
/** The error eBay gives for an item number that belongs to a listing with options. */
const NEEDS_GROUP = 11006;

/**
 * Statuses that mean our keys or request are wrong, so an operator must act: 400 a malformed
 * request or a refused grant, 401 a bad key, 403 a refused one. The item number and option number
 * are capped to digits, and an option number the owner pasted is answered by falling back to the
 * group lookup (Plan 15 ruling 2), so a 400 that reaches here can't come from what the owner
 * pasted. 429 and 5xx are outages.
 */
const MISCONFIGURED = new Set([400, 401, 403]);

const NO_METADATA: LookupResult = { ok: false, reason: 'NO_METADATA' };
const TIMEOUT: LookupResult = { ok: false, reason: 'TIMEOUT' };

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** One answer: its status, and its JSON body when it had one. */
interface Answer {
  status: number;
  body: unknown;
  readable: boolean;
}

/**
 * The real eBay lookup: a token for each lookup, then one item (or, for a listing with options and
 * no option number, one item group), sending only the item number and the option number. The
 * answer is used once, to prefill the add form, and never stored or refreshed (D69, D107).
 */
export class EbayBrowseLookup implements EbayLookup {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async lookUp(ref: string, signal: AbortSignal): Promise<LookupResult> {
    if (signal.aborted) return TIMEOUT;
    const { itemId, variationId } = parseEbayRef(ref);
    const call = async (url: string, init: RequestInit): Promise<Answer> => {
      const res = await this.fetchFn(url, { ...init, signal });
      try {
        return { status: res.status, body: await res.json(), readable: true };
      } catch (err) {
        if (signal.aborted) throw err;
        return { status: res.status, body: undefined, readable: false };
      }
    };
    try {
      const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
      const auth = await call(TOKEN_URL, {
        method: 'POST',
        headers: {
          authorization: `Basic ${basic}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'client_credentials', scope: SCOPE }).toString(),
      });
      if (auth.status !== 200) return failure(auth.status);
      const accessToken = isObject(auth.body) ? auth.body.access_token : undefined;
      if (typeof accessToken !== 'string' || accessToken === '') return outage(auth.status);
      const headers = {
        authorization: `Bearer ${accessToken}`,
        'x-ebay-c-marketplace-id': 'EBAY_US',
        accept: 'application/json',
      };

      const variation = variationId ? `&legacy_variation_id=${variationId}` : '';
      const item = await call(`${ITEM_URL}?legacy_item_id=${itemId}${variation}`, { headers });
      if (item.status === 200) return item.readable ? fromItem(item.body, itemId) : outage(200);
      // A listing with options needs its group; so does an option number that eBay doesn't know,
      // because the owner's link may be stale.
      const needsGroup = variationId
        ? item.status === 400 || item.status === 404
        : item.status === 400 && hasError(item.body, NEEDS_GROUP);
      if (!needsGroup) return item.status === 404 ? NO_METADATA : failure(item.status);

      const group = await call(`${GROUP_URL}?item_group_id=${itemId}`, { headers });
      if (group.status === 200) return group.readable ? fromGroup(group.body, itemId) : outage(200);
      return group.status === 404 ? NO_METADATA : failure(group.status);
    } catch {
      if (signal.aborted) return TIMEOUT;
      return { ok: false, reason: 'LOOKUP_UNAVAILABLE', misconfigured: false };
    }
  }
}

function failure(status: number): LookupResult {
  return {
    ok: false,
    reason: 'LOOKUP_UNAVAILABLE',
    status,
    misconfigured: MISCONFIGURED.has(status),
  };
}

function outage(status: number): LookupResult {
  return { ok: false, reason: 'LOOKUP_UNAVAILABLE', status, misconfigured: false };
}

function hasError(body: unknown, errorId: number): boolean {
  return (
    isObject(body) &&
    Array.isArray(body.errors) &&
    body.errors.some((error) => isObject(error) && error.errorId === errorId)
  );
}

/** What the page shows for an item. No description: eBay's is seller-written text (D111). */
function prefill(
  fields: { title: unknown; imageUrl: unknown; price: Money | undefined },
  itemId: string,
): LookupResult {
  const metadata = productMetadata(
    {
      title: fields.title,
      imageUrl: fields.imageUrl,
      amount: fields.price?.value,
      currency: fields.price?.currency,
    },
    new URL(`https://www.ebay.com/itm/${itemId}`),
  );
  return metadata.title || metadata.imageUrl || metadata.priceText
    ? { ok: true, metadata }
    : NO_METADATA;
}

function fromItem(body: unknown, itemId: string): LookupResult {
  if (!isObject(body) || notForSale(body)) return NO_METADATA;
  return prefill({ title: body.title, imageUrl: imageOf(body), price: askingPrice(body) }, itemId);
}

/**
 * A listing with options and no option number: the first option's title and photo (the first
 * with one), and a price only when every option is for sale at the same fixed price (§5.3).
 */
function fromGroup(body: unknown, itemId: string): LookupResult {
  const items = isObject(body) && Array.isArray(body.items) ? body.items.filter(isObject) : [];
  const [first] = items;
  if (!first) return NO_METADATA;
  const prices = items.map(askingPrice);
  const [price] = prices;
  const agree = prices.every(
    (other) => other && price && other.value === price.value && other.currency === price.currency,
  );
  return prefill(
    {
      title: first.title,
      imageUrl: items.map(imageOf).find((url) => typeof url === 'string'),
      price: agree ? price : undefined,
    },
    itemId,
  );
}

interface Money {
  value: string | number;
  currency: string;
}

/**
 * The item's price, only when it is an asking price. On a pure auction `price` is the live bid, and
 * on a mixed one it is unknown (D108), so both have none.
 */
function askingPrice(item: JsonObject): Money | undefined {
  const options = Array.isArray(item.buyingOptions) ? item.buyingOptions : [];
  if (!options.includes('FIXED_PRICE') || options.includes('AUCTION')) return undefined;
  const { price } = item;
  if (!isObject(price)) return undefined;
  const { value, currency } = price;
  return (typeof value === 'string' || typeof value === 'number') && typeof currency === 'string'
    ? { value, currency }
    : undefined;
}

function imageOf(item: JsonObject): unknown {
  return isObject(item.image) ? item.image.imageUrl : undefined;
}

/** An ended or removed listing isn't prefilled as if it were live (Plan 15 ruling 3). */
function notForSale(item: JsonObject): boolean {
  const availabilities: unknown[] = Array.isArray(item.estimatedAvailabilities)
    ? item.estimatedAvailabilities
    : [];
  const availability = availabilities[0];
  return isObject(availability) && availability.estimatedAvailabilityStatus === 'OUT_OF_STOCK';
}

/** eBay is on only when both keys are set (eBay lookups §5.6); either one alone leaves it off. */
export function ebayLookupFrom(env: {
  EBAY_CLIENT_ID?: string | undefined;
  EBAY_CLIENT_SECRET?: string | undefined;
}): EbayLookup | null {
  const { EBAY_CLIENT_ID: id, EBAY_CLIENT_SECRET: secret } = env;
  return id && secret ? new EbayBrowseLookup(id, secret) : null;
}
