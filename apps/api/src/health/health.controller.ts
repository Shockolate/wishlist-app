import { Controller, Get, Header, Inject } from '@nestjs/common';
import type { HealthResponse } from '@wishlist/contracts';
import { ENV, type Env } from '../core/env.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(ENV) private readonly env: Env) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  get(): HealthResponse {
    return { status: 'ok', sha: this.env.GIT_SHA };
  }
}
