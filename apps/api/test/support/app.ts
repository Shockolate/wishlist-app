import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { APP_OPTIONS, configureApp } from '../../src/configure-app.js';
import { ENV, type Env } from '../../src/core/env.js';
import { testEnv } from '../../src/testing/test-env.js';

export interface TestAppOptions {
  databaseUrl: string;
  env?: Partial<Env>;
  override?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

/** Boots the real AppModule against the given database, with the production HTTP pipeline. */
export async function createTestApp({
  databaseUrl,
  env = {},
  override = (builder) => builder,
}: TestAppOptions): Promise<NestExpressApplication> {
  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENV)
    .useValue(testEnv({ DATABASE_URL: databaseUrl, ...env }));
  const moduleRef = await override(builder).compile();
  const app = configureApp(
    moduleRef.createNestApplication<NestExpressApplication>({ ...APP_OPTIONS, logger: false }),
  );
  await app.init();
  return app;
}
