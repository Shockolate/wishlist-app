import { createHash, timingSafeEqual } from 'node:crypto';
import { Controller, Get, Header, Inject, Req } from '@nestjs/common';
import type { CleanupResult } from '@wishlist/contracts';
import type { Request } from 'express';
import { ENV, type Env } from '../core/env.js';
import { unauthenticated } from '../http/errors.js';
import { CleanupService } from './cleanup.service.js';

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

@Controller('internal/cron')
export class CronController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(CleanupService) private readonly cleanup: CleanupService,
  ) {}

  /** Vercel Cron calls this daily (apps/api/vercel.json) with `Authorization: Bearer $CRON_SECRET`. */
  @Get('daily')
  @Header('Cache-Control', 'no-store')
  async daily(@Req() req: Request): Promise<CleanupResult> {
    if (!this.fromVercelCron(req.headers.authorization)) throw unauthenticated();
    return this.cleanup.runDaily();
  }

  private fromVercelCron(authorization: string | undefined): boolean {
    const secret = this.env.CRON_SECRET;
    if (!secret || !authorization) return false;
    // Compare fixed-length digests, so the check takes the same time however much matches.
    return timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`));
  }
}
