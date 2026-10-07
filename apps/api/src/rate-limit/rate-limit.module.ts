import { Module } from '@nestjs/common';
import { RateLimiter } from './rate-limiter.js';

/** Storage for rate limits. Plan 2 wires it to endpoints (spec §6.6). */
@Module({ providers: [RateLimiter], exports: [RateLimiter] })
export class RateLimitModule {}
