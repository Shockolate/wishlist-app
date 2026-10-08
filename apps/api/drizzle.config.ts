import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

if (existsSync('.env')) process.loadEnvFile('.env');

// Migrations prefer the direct (non-pooled) connection: Neon recommends it for schema changes,
// since DDL through a transaction-mode pooler is a known source of surprises.
const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  ...(url ? { dbCredentials: { url } } : {}),
  strict: true,
  verbose: true,
});
