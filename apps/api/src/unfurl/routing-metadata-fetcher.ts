import { Logger } from '@nestjs/common';
import {
  amazonProductOf,
  etsyListingOf,
  isAmazonShortLink,
  isEtsyShortLink,
  type Retailer,
  type UnfurlFailureReason,
  type UnfurlResponse,
  type UrlLike,
} from '@wishlist/contracts';
import type { ErrorReporter } from '../observability/error-reporter.js';
import type { AmazonLookup, LookupResult } from './amazon-lookup.js';
import type { EtsyLookup } from './etsy-lookup.js';
import type { MetadataFetcher } from './metadata-fetcher.js';
import type { PageFetcher } from './page-fetcher.js';

/** One Amazon lookup, short-link hops included: the waiting panel promises half a minute. */
export const AMAZON_DEADLINE_MS = 30_000;
/** One Etsy lookup, `etsy.me` hops included: the same 5 seconds as the page fetch (§5.3). */
export const ETSY_DEADLINE_MS = 5_000;

export interface RetailerLookups {
  amazon: AmazonLookup | null;
  etsy: EtsyLookup | null;
}

/** How each retailer's links are read, and how a refused lookup is reported. */
const RETAILERS: Record<
  Retailer,
  {
    idOf: (url: UrlLike) => string | null;
    isShortLink: (url: UrlLike) => boolean;
    refused: string;
  }
> = {
  amazon: {
    idOf: (url) => amazonProductOf(url)?.asin ?? null,
    isShortLink: isAmazonShortLink,
    refused: 'Bright Data refused an Amazon lookup',
  },
  etsy: {
    idOf: (url) => etsyListingOf(url)?.listingId ?? null,
    isShortLink: isEtsyShortLink,
    refused: 'Etsy refused a listing lookup',
  },
};

/**
 * Unfurl's front door (retailer lookups §5.1–§5.4). An amazon.com product link or an Etsy listing
 * link, or a short link that leads to one, is looked up through that retailer's port, sending only
 * its ID. Every other link, and every link of a retailer whose port is null (no key), takes the page
 * fetch exactly as before. Never throws; like the page fetch, it logs a failure's host and reason,
 * never the URL.
 */
export class RoutingMetadataFetcher implements MetadataFetcher {
  private readonly logger = new Logger('Unfurl');

  constructor(
    private readonly pages: MetadataFetcher,
    private readonly links: Pick<PageFetcher, 'resolve'>,
    private readonly lookups: RetailerLookups,
    private readonly reporter: ErrorReporter,
    private readonly deadlines: Record<Retailer, number> = {
      amazon: AMAZON_DEADLINE_MS,
      etsy: ETSY_DEADLINE_MS,
    },
  ) {}

  async fetch(url: string): Promise<UnfurlResponse> {
    const retailer = (Object.keys(RETAILERS) as Retailer[]).find(
      (name) => RETAILERS[name].idOf(url) !== null || RETAILERS[name].isShortLink(url),
    );
    if (!retailer) return this.pages.fetch(url);
    const lookup = this.lookups[retailer];
    if (!lookup) return this.pages.fetch(url);
    const { idOf, refused } = RETAILERS[retailer];
    const host = new URL(url).hostname;
    const deadline = AbortSignal.timeout(this.deadlines[retailer]);

    let id = idOf(url);
    if (!id) {
      const resolved = await this.links.resolve(url, (hop) => idOf(hop) !== null, deadline);
      if (resolved.ok === false) return this.failed(resolved.reason, resolved.host ?? host);
      id = idOf(resolved.url);
      if (!id) return this.failed('NO_METADATA', host);
    }

    const result: LookupResult = await lookup.lookUp(id, deadline);
    // `=== true`, not truthiness: Vercel's builder type-checks without strictNullChecks (see metadata-fetcher.ts).
    if (result.ok === true) return result.metadata;
    if (result.reason !== 'LOOKUP_UNAVAILABLE') return this.failed(result.reason, host);
    if (result.misconfigured) {
      // An operator has to act: the key, the account or the dataset is wrong. No URL, no ID.
      this.reporter.captureWarning(`${refused} with status ${result.status ?? 'none'}`);
    }
    this.logger.log(
      `unfurl LOOKUP_UNAVAILABLE host=${host} provider=${retailer} status=${result.status ?? 'none'}`,
    );
    return { failureReason: 'LOOKUP_UNAVAILABLE' };
  }

  private failed(reason: UnfurlFailureReason, host: string): UnfurlResponse {
    this.logger.log(`unfurl ${reason} host=${host}`);
    return { failureReason: reason };
  }
}
