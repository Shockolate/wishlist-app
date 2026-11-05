import { Inject, Injectable } from '@nestjs/common';
import type { UnfurlResponse } from '@wishlist/contracts';
import { eq } from 'drizzle-orm';
import { DB, type Database } from '../db/database.module.js';
import { wishlists } from '../db/schema.js';
import { rateLimitKey } from '../rate-limit/keys.js';
import { RateLimiter } from '../rate-limit/rate-limiter.js';
import type { RateLimitRule } from '../rate-limit/window.js';
import { convertToUsd } from '../unfurl/convert-price.js';
import { EXCHANGE_RATES, type ExchangeRates } from '../unfurl/exchange-rates.js';
import { METADATA_FETCHER, type MetadataFetcher } from '../unfurl/metadata-fetcher.js';

/** Spec §6.6. */
export const UNFURL_PER_USER: RateLimitRule = { limit: 60, windowSeconds: 3600 };

/**
 * A link prefill for the owner (spec §5). Nothing is saved. When the owner's list has
 * `convertPrices` on, a price in another currency is replaced by its dollar equivalent and the
 * original text goes in `convertedFrom` (price conversion design §5.4). This is the only place the
 * fetchers' internal `price` is removed: the controller doesn't serialize through a schema.
 */
@Injectable()
export class UnfurlService {
  constructor(
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(METADATA_FETCHER) private readonly fetcher: MetadataFetcher,
    @Inject(DB) private readonly db: Database,
    @Inject(EXCHANGE_RATES) private readonly rates: ExchangeRates,
  ) {}

  /** Every call counts against the owner's hourly limit, before anything is fetched. */
  async unfurl(userId: string, url: string): Promise<UnfurlResponse> {
    await this.limiter.enforce(rateLimitKey('unfurl:user', userId), UNFURL_PER_USER);
    const { price, ...response } = await this.fetcher.fetch(url);
    // Steps 1 and 2: nothing to convert, already dollars, or the owner (or a deleted account) says no.
    if (!price || !response.priceText || price.currency === 'USD') return response;
    if (!(await this.convertsPrices(userId))) return response;
    // Steps 3 to 5: any step that can't produce a usable dollar text leaves the price as it was read.
    const rate = await this.rates.usdPer(price.currency);
    if (rate === null) return response;
    const converted = convertToUsd(price, rate);
    if (converted === null) return response;
    // Step 6.
    return { ...response, priceText: converted, convertedFrom: response.priceText };
  }

  /** No list row (the account was deleted after the session check) means don't convert. */
  private async convertsPrices(ownerId: string): Promise<boolean> {
    const [list] = await this.db
      .select({ convertPrices: wishlists.convertPrices })
      .from(wishlists)
      .where(eq(wishlists.ownerId, ownerId));
    return list?.convertPrices ?? false;
  }
}
