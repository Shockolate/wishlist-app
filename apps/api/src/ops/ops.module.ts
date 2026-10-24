import { Module } from '@nestjs/common';
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
  ],
})
export class OpsModule {}
