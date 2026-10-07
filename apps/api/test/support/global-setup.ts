import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';
import { runMigrations } from '../../src/db/migrate.js';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/** One Postgres container per integration run, migrated with the committed migrations. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const url = container.getConnectionUri();
  await runMigrations(url);
  project.provide('databaseUrl', url);
  return async () => {
    await container.stop();
  };
}
