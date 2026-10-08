import { Module } from '@nestjs/common';
import { DB_HEALTH, PostgresDbHealth } from './db-health.js';
import { HealthController } from './health.controller.js';

@Module({
  controllers: [HealthController],
  providers: [{ provide: DB_HEALTH, useClass: PostgresDbHealth }],
})
export class HealthModule {}
