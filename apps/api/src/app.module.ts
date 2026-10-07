import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module.js';
import { DatabaseModule } from './db/database.module.js';
import { HealthModule } from './health/health.module.js';

@Module({ imports: [CoreModule, DatabaseModule, HealthModule] })
export class AppModule {}
