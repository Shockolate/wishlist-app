import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import { GiftsController } from './gifts.controller.js';
import { GiftsService } from './gifts.service.js';

/** Your gifts: a verified gifter's linked claims across lists (design §5). */
@Module({
  imports: [AuthModule, RateLimitModule],
  controllers: [GiftsController],
  providers: [GiftsService],
})
export class GiftsModule {}
