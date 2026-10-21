import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import { HttpMetadataFetcher, METADATA_FETCHER } from '../unfurl/metadata-fetcher.js';
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
    { provide: METADATA_FETCHER, useFactory: () => new HttpMetadataFetcher() },
  ],
})
export class WishlistModule {}
