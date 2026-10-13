import { Inject, Injectable } from '@nestjs/common';
import type { UnfurlResponse } from '@wishlist/contracts';
import { rateLimitKey } from '../rate-limit/keys.js';
import { RateLimiter } from '../rate-limit/rate-limiter.js';
import type { RateLimitRule } from '../rate-limit/window.js';
import { METADATA_FETCHER, type MetadataFetcher } from '../unfurl/metadata-fetcher.js';

/** Spec §6.6. */
export const UNFURL_PER_USER: RateLimitRule = { limit: 60, windowSeconds: 3600 };

/** A link prefill for the owner (spec §5). Nothing is saved. */
@Injectable()
export class UnfurlService {
  constructor(
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(METADATA_FETCHER) private readonly fetcher: MetadataFetcher,
  ) {}

  /** Every call counts against the owner's hourly limit, before anything is fetched. */
  async unfurl(userId: string, url: string): Promise<UnfurlResponse> {
    await this.limiter.enforce(rateLimitKey('unfurl:user', userId), UNFURL_PER_USER);
    return this.fetcher.fetch(url);
  }
}
