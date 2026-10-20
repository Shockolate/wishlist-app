import { Controller, Get, Header, HttpStatus, Inject, Res } from '@nestjs/common';
import type { HealthResponse, LiveResponse } from '@wishlist/contracts';
import type { Response } from 'express';
import { ENV, type Env } from '../core/env.js';
import { DB_HEALTH, type DbHealth } from './db-health.js';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DB_HEALTH) private readonly db: DbHealth,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async get(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const db = await this.db.check();
    if (!db.ok) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return {
        status: 'degraded',
        sha: this.env.GIT_SHA,
        db: { ok: false, migrationsApplied: null },
      };
    }
    return { status: 'ok', sha: this.env.GIT_SHA, db };
  }

  /**
   * For the uptime check that runs every few minutes (D47). It never touches the pool: checking
   * /api/health that often would keep Neon awake past its free compute quota.
   */
  @Get('live')
  @Header('Cache-Control', 'no-store')
  live(): LiveResponse {
    return { status: 'ok', sha: this.env.GIT_SHA };
  }
}
