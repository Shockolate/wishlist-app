import { Module } from '@nestjs/common';
import { CleanupService } from './cleanup.service.js';
import { CronController } from './cron.controller.js';

/** Scheduled maintenance (spec §10). */
@Module({ controllers: [CronController], providers: [CleanupService] })
export class OpsModule {}
