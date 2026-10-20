import './load-env.js';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { APP_OPTIONS, configureApp } from './configure-app.js';
import { ENV, type Env } from './core/env.js';

async function bootstrap(): Promise<void> {
  const app = configureApp(
    await NestFactory.create<NestExpressApplication>(AppModule, APP_OPTIONS),
  );
  app.enableShutdownHooks();
  await app.listen(app.get<Env>(ENV).PORT);
}

void bootstrap();
