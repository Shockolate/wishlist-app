import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import { HttpPhotoFetcher, PHOTO_FETCHER } from '../unfurl/photo-fetcher.js';
import { ClaimLinksController } from './claim-links.controller.js';
import { ClaimsController } from './claims.controller.js';
import { ClaimsService } from './claims.service.js';
import { SharePreviewService } from './share-preview.service.js';
import { SharedController } from './shared.controller.js';
import { SharedListService } from './shared-list.service.js';

/** Share links and claims (spec §5 Public endpoints, §5.1, §6.3). */
@Module({
  imports: [AuthModule, RateLimitModule],
  controllers: [SharedController, ClaimsController, ClaimLinksController],
  providers: [
    SharedListService,
    ClaimsService,
    SharePreviewService,
    { provide: PHOTO_FETCHER, useFactory: () => new HttpPhotoFetcher() },
  ],
})
export class ClaimsModule {}
