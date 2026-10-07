import { existsSync } from 'node:fs';

// Local development only: Vercel injects environment variables directly. loadEnvFile never
// overrides a variable that is already set.
if (process.env.NODE_ENV !== 'production' && existsSync('.env')) {
  process.loadEnvFile('.env');
}
