import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import { ENV, type Env } from '../core/env.js';
import { ERROR_REPORTER, type ErrorReporter } from '../observability/error-reporter.js';
import { BrightDataAmazonLookup } from '../unfurl/amazon-lookup.js';
import { ebayLookupFrom } from '../unfurl/ebay-lookup.js';
import { EtsyOpenApiLookup } from '../unfurl/etsy-lookup.js';
import { HttpMetadataFetcher, METADATA_FETCHER } from '../unfurl/metadata-fetcher.js';
import { PageFetcher } from '../unfurl/page-fetcher.js';
import { RoutingMetadataFetcher } from '../unfurl/routing-metadata-fetcher.js';
import { ItemsController } from './items.controller.js';
import { ItemsService } from './items.service.js';
import { TagsController } from './tags.controller.js';
import { TagsService } from './tags.service.js';
import { UnfurlService } from './unfurl.service.js';
import { WishlistController } from './wishlist.controller.js';
import { WishlistService } from './wishlist.service.js';

/** The owner's list and its items (spec §5 Owner endpoints). */
@Module({
  imports: [AuthModule, RateLimitModule],
  controllers: [WishlistController, ItemsController, TagsController],
  providers: [
    WishlistService,
    ItemsService,
    TagsService,
    UnfurlService,
    {
      provide: METADATA_FETCHER,
      inject: [ENV, ERROR_REPORTER],
      // Amazon links go to Bright Data, Etsy links to Etsy's Open API and eBay links to eBay's
      // Browse API, only when that retailer's key is set (both keys, for eBay; lookups §5.6).
      useFactory: (env: Env, reporter: ErrorReporter) => {
        const pages = new PageFetcher();
        const { BRIGHT_DATA_API_KEY: amazonKey, ETSY_API_KEY: etsyKey } = env;
        return new RoutingMetadataFetcher(
          new HttpMetadataFetcher(pages),
          pages,
          {
            amazon: amazonKey ? new BrightDataAmazonLookup(amazonKey) : null,
            etsy: etsyKey ? new EtsyOpenApiLookup(etsyKey) : null,
            ebay: ebayLookupFrom(env),
          },
          reporter,
        );
      },
    },
  ],
})
export class WishlistModule {}
