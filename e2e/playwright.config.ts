import { defineConfig, devices } from '@playwright/test';

// Not 3000/3001, so E2E can run while `pnpm dev` is up.
const WEB_PORT = 3100;
const API_PORT = 3101;
const databaseUrl =
  process.env.E2E_DATABASE_URL ?? 'postgres://wishlist:wishlist@localhost:54329/wishlist_e2e';

export default defineConfig({
  testDir: './tests/local',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Production builds, not dev servers: E2E should exercise what ships. scripts/e2e.sh builds
  // them first (the web build must see API_ORIGIN=http://localhost:3101).
  webServer: [
    {
      command: 'node dist/main.js',
      cwd: '../apps/api',
      url: `http://localhost:${API_PORT}/api/health`,
      env: {
        NODE_ENV: 'production',
        PORT: String(API_PORT),
        DATABASE_URL: databaseUrl,
        GIT_SHA: 'e2e',
        APP_ORIGIN: `http://localhost:${WEB_PORT}`,
      },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `pnpm exec next start --port ${WEB_PORT}`,
      cwd: '../apps/web',
      url: `http://localhost:${WEB_PORT}`,
      env: { API_ORIGIN: `http://localhost:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
