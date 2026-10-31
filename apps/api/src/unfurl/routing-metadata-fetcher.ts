import { Logger } from '@nestjs/common';
import {
  amazonProductOf,
  ebayItemOf,
  etsyListingOf,
  isAmazonShortLink,
  isEtsyShortLink,
  type Retailer,
  type UnfurlFailureReason,
  type UnfurlResponse,
  type UrlLike,
} from '@wishlist/contracts';
import type { ErrorReporter } from '../observability/error-reporter.js';
import type { AmazonLookup } from './amazon-lookup.js';
import { ebayRef, type EbayLookup } from './ebay-lookup.js';
import type { EtsyLookup } from './etsy-lookup.js';
import type { LookupResult } from './lookup-result.js';
import type { MetadataFetcher } from './metadata-fetcher.js';
import type { PageFetcher } from './page-fetcher.js';

/** One Amazon lookup, short-link hops included: the waiting panel promises half a minute. */
export const AMAZON_DEADLINE_MS = 30_000;
/** One Etsy lookup, `etsy.me` hops included: the same 5 seconds as the page fetch (§5.3). */
export const ETSY_DEADLINE_MS = 5_000;
/** One eBay lookup: the token and up to two calls after it, measured at about 1.6 s (eBay lookups §5.2). */
export const EBAY_DEADLINE_MS = 5_000;

export interface RetailerLookups {
  amazon: AmazonLookup | null;
  etsy: EtsyLookup | null;
  ebay: EbayLookup | null;
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
  ebay: {
    idOf: (url) => {
      const item = ebayItemOf(url);
      return item ? ebayRef(item) : null;
    },
    // ebay.us links keep the page fetch (eBay lookups §5.1).
    isShortLink: () => false,
    refused: 'eBay refused a lookup',
  },
};

/**
 * etsy.com, any subdomain of it, etsy.me, ebay.com or www.ebay.com: the shops whose details are for
 * the prefill only, so none of their descriptions is ever passed on (D69, D111). Exact or
 * dot-suffix matches only, so `notetsy.com`, `etsy.com.evil.test` and `www.ebay.com.evil.test` are
 * not these shops.
 */
function dropsDescription(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return (
    host === 'etsy.me' ||
    host === 'etsy.com' ||
    host.endsWith('.etsy.com') ||
    host === 'ebay.com' ||
    host === 'www.ebay.com'
  );
}

/**
 * Unfurl's front door (retailer lookups §5.1–§5.4). An amazon.com product link or an Etsy listing
 * link, or a short link that leads to one, is looked up through that retailer's port, sending only
 * its ID. Every other link, and every link of a retailer whose port is null (no key), takes the page
 * fetch exactly as before. Never throws; like the page fetch, it logs a failure's host and reason,
 * never the URL. An Etsy link never gets a description, by any path (tag suggestions D74, D69): the
 * page fetch would otherwise pass on its `og:description` while the Etsy key is unset, or for an
 * Etsy page that isn't a listing.
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
      ebay: EBAY_DEADLINE_MS,
    },
  ) {}

  async fetch(url: string): Promise<UnfurlResponse> {
    const response = await this.route(url);
    if (!dropsDescription(url)) return response;
    const { description: _dropped, ...rest } = response;
    return rest;
  }

  private async route(url: string): Promise<UnfurlResponse> {
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
