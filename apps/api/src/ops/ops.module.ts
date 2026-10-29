import { Module } from '@nestjs/common';
import { CLOCK, type Clock } from '../core/clock.js';
import { ENV, type Env } from '../core/env.js';
import { ERROR_REPORTER, type ErrorReporter } from '../observability/error-reporter.js';
import { CleanupService } from './cleanup.service.js';
import {
  BetterStackCronHeartbeat,
  CRON_HEARTBEAT,
  NO_HEARTBEAT,
  type CronHeartbeat,
} from './cron-heartbeat.js';
import { CronController } from './cron.controller.js';
import { NeonQuotaCheck, NO_QUOTA_CHECK, QUOTA_CHECK, type QuotaCheck } from './neon-quota.js';

/** Scheduled maintenance (spec §10). */
@Module({
  controllers: [CronController],
  providers: [
    CleanupService,
    {
      provide: CRON_HEARTBEAT,
      inject: [ENV, ERROR_REPORTER],
      // Unset means no heartbeat, and no outside call (D86).
      useFactory: (env: Env, reporter: ErrorReporter): CronHeartbeat =>
        env.CRON_HEARTBEAT_URL
          ? new BetterStackCronHeartbeat(env.CRON_HEARTBEAT_URL, reporter)
          : NO_HEARTBEAT,
    },
    {
      provide: QUOTA_CHECK,
      inject: [ENV, ERROR_REPORTER, CLOCK],
      // Unset means no check, and no outside call (D105). The env check sets all three or none.
      useFactory: (env: Env, reporter: ErrorReporter, clock: Clock): QuotaCheck =>
        env.NEON_PROJECT_ID && env.NEON_USAGE_API_KEY && env.NEON_QUOTA_HEARTBEAT_URL
          ? new NeonQuotaCheck(
              env.NEON_PROJECT_ID,
              env.NEON_USAGE_API_KEY,
              new BetterStackCronHeartbeat(
                env.NEON_QUOTA_HEARTBEAT_URL,
                reporter,
                fetch,
                'neon quota heartbeat',
              ),
              reporter,
              clock,
            )
          : NO_QUOTA_CHECK,
    },
  ],
})
export class OpsModule {}
