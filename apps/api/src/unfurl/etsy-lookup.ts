import { decodeHTML } from 'entities/decode';
import type { LookupResult } from './lookup-result.js';
import { productMetadata } from './metadata.js';

/** The Etsy lookup port (retailer lookups §5.3). Never throws. */
export interface EtsyLookup {
  lookUp(listingId: string, signal: AbortSignal): Promise<LookupResult>;
}

/**
 * Statuses that mean our key or request is wrong, so an operator must act: 401 a missing key, 403 a
 * refused one, and 400 a malformed request. Listing IDs are capped so they always fit Etsy's int64
 * (Plan 8b ruling 1), so a 400 can't come from what the owner pasted. 429 and 5xx are outages.
 */
const MISCONFIGURED = new Set([400, 401, 403]);

/**
 * The real Etsy lookup: one listing per request, sending only its ID. The answer is used once, to
 * prefill the add form, and never stored or refreshed from Etsy (D69).
 */
export class EtsyOpenApiLookup implements EtsyLookup {
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async lookUp(listingId: string, signal: AbortSignal): Promise<LookupResult> {
    if (signal.aborted) return { ok: false, reason: 'TIMEOUT' };
    let res: Response | undefined;
    let body: unknown;
    try {
      res = await this.fetchFn(
        `https://api.etsy.com/v3/application/listings/${listingId}?includes=Images`,
        {
          method: 'GET',
          headers: { 'x-api-key': this.apiKey, accept: 'application/json' },
          signal,
        },
      );
      if (res.status === 404) return { ok: false, reason: 'NO_METADATA' };
      if (res.status !== 200) {
        return {
          ok: false,
          reason: 'LOOKUP_UNAVAILABLE',
          status: res.status,
          misconfigured: MISCONFIGURED.has(res.status),
        };
      }
      body = await res.json();
    } catch {
      if (signal.aborted) return { ok: false, reason: 'TIMEOUT' };
      // `res` is set when the request answered and its body was unreadable.
      return res
        ? { ok: false, reason: 'LOOKUP_UNAVAILABLE', status: res.status, misconfigured: false }
        : { ok: false, reason: 'LOOKUP_UNAVAILABLE', misconfigured: false };
    }
    if (typeof body !== 'object' || body === null) return { ok: false, reason: 'NO_METADATA' };
    const listing = body as Record<string, unknown>;
    // A listing that's sold out, removed, a draft or expired isn't prefilled as if it were for sale.
    if (listing.state !== 'active') return { ok: false, reason: 'NO_METADATA' };
    const price = priceOf(listing.price);
    const metadata = productMetadata(
      {
        // Etsy returns titles with HTML entities encoded, such as `&#39;` and `&amp;`.
        title: typeof listing.title === 'string' ? decodeHTML(listing.title) : undefined,
        imageUrl: firstImage(listing.images),
        amount: price?.amount,
        currency: price?.currency,
      },
      new URL(`https://www.etsy.com/listing/${listingId}`),
    );
    return metadata.title || metadata.imageUrl || metadata.priceText
      ? { ok: true, metadata }
      : { ok: false, reason: 'NO_METADATA' };
  }
}

/** The image Etsy shows first (lowest rank), at listing-page size, else full size (Plan 8b ruling 2). */
function firstImage(images: unknown): unknown {
  if (!Array.isArray(images)) return undefined;
  const ranked = images
    .filter(
      (image): image is Record<string, unknown> => typeof image === 'object' && image !== null,
    )
    .sort((a, b) => rankOf(a) - rankOf(b));
  const first = ranked[0];
  return first ? (first.url_570xN ?? first.url_fullxfull) : undefined;
}

function rankOf(image: Record<string, unknown>): number {
  return typeof image.rank === 'number' ? image.rank : Number.MAX_SAFE_INTEGER;
}

/** Etsy's Money: `amount ÷ divisor` in `currency_code`. Nothing when the divisor isn't usable. */
function priceOf(money: unknown): { amount: number; currency: unknown } | undefined {
  if (typeof money !== 'object' || money === null) return undefined;
  const { amount, divisor, currency_code } = money as Record<string, unknown>;
  if (typeof amount !== 'number' || !Number.isInteger(divisor) || (divisor as number) <= 0) {
    return undefined;
  }
  return { amount: amount / (divisor as number), currency: currency_code };
}
