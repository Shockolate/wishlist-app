import type { Server } from 'node:http';
import type { INestApplication, ModuleMetadata } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { APP_OPTIONS, configureApp } from '../configure-app.js';

/** Boots a Nest app from the given module metadata with the production HTTP pipeline. */
export async function createUnitApp(metadata: ModuleMetadata): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule(metadata).compile();
  const app = configureApp(
    moduleRef.createNestApplication<NestExpressApplication>({ ...APP_OPTIONS, logger: false }),
  );
  await app.init();
  return app;
}

export function http(app: INestApplication) {
  return request(app.getHttpServer() as Server);
}
