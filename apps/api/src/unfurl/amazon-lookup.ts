import { amazonProductUrl } from '@wishlist/contracts';
import type { LookupResult } from './lookup-result.js';
import { productMetadata } from './metadata.js';

/** The Amazon lookup port (retailer lookups §5.2). Never throws. */
export interface AmazonLookup {
  lookUp(asin: string, signal: AbortSignal): Promise<LookupResult>;
}

export const AMAZON_LOOKUP = Symbol('AMAZON_LOOKUP');

/** Bright Data's Amazon Products dataset, asked synchronously for one product. */
const ENDPOINT =
  'https://api.brightdata.com/datasets/v3/scrape?dataset_id=gd_l7q7dkf244hwjntr0&format=json';

/**
 * Statuses that mean our account, key, dataset or request is wrong, so an operator must act
 * (https://docs.brightdata.com/products/scrapers/error-codes): 400 is a bad request, 401 a bad key,
 * 404 an unknown dataset. 403 isn't documented but can only mean refused credentials. Running out of
 * credits isn't documented at all; a not-yet-active account answered `400 Customer is not active`
 * in the 2026-10-22 spike, so it is reported too (Plan 8a ruling 2). 429 and 5xx are outages.
 */
const MISCONFIGURED = new Set([400, 401, 403, 404]);

/** The real Amazon lookup: one product per request, sending only its canonical URL. */
export class BrightDataAmazonLookup implements AmazonLookup {
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async lookUp(asin: string, signal: AbortSignal): Promise<LookupResult> {
    const url = amazonProductUrl(asin);
    if (signal.aborted) return { ok: false, reason: 'TIMEOUT' };
    let res: Response | undefined;
    let body: unknown;
    try {
      res = await this.fetchFn(ENDPOINT, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ input: [{ url }] }),
        signal,
      });
      // Past Bright Data's own minute the job continues as a snapshot, which we never poll.
      if (res.status === 202) return { ok: false, reason: 'TIMEOUT' };
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
    const record: unknown = Array.isArray(body) ? body[0] : undefined;
    if (typeof record !== 'object' || record === null) return { ok: false, reason: 'NO_METADATA' };
    const fields = record as Record<string, unknown>;
    const images = Array.isArray(fields.images) ? (fields.images as unknown[]) : [];
    const metadata = productMetadata(
      {
        title: fields.title,
        imageUrl: fields.image_url ?? images[0],
        amount: fields.final_price,
        currency: fields.currency,
      },
      new URL(url),
    );
    return metadata.title || metadata.imageUrl || metadata.priceText
      ? { ok: true, metadata }
      : { ok: false, reason: 'NO_METADATA' };
  }
}
