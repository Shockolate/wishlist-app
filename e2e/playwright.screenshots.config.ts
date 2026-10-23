import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config.js';

/**
 * The README's screenshots, taken by hand and never by CI (Plan 9 ruling 11). It reuses the main
 * config's web servers, so the images come from the same production builds the E2E tests use. Run
 * it the way `scripts/e2e.sh` runs the tests: `scripts/e2e.sh --config playwright.screenshots.config.ts`.
 */
export default defineConfig({
  ...base,
  testDir: './screenshots',
  // One image at a time: each test seeds its own owner, and a retry would only hide a bad picture.
  fullyParallel: false,
  retries: 0,
  projects: [
    {
      name: 'desktop',
      // The size the README's editor image has always had.
      use: { ...devices['Desktop Chrome'], viewport: { width: 1100, height: 1000 } },
    },
    {
      name: 'phone',
      // A 390 x 844 phone at twice the pixels, which is what share.png and claim.png are.
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
