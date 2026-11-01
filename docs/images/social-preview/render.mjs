// Renders card.html to ../social-preview.png, the repository's social preview (1280 x 640).
// It needs no app and no Docker, only the Chromium that `pnpm --filter @wishlist/e2e exec playwright
// install chromium` fetches. Run it by hand: `node docs/images/social-preview/render.mjs`.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Playwright lives in the e2e workspace, so resolve it from there.
const require = createRequire(new URL('../../../e2e/package.json', import.meta.url));
const { chromium } = require('@playwright/test');

const card = fileURLToPath(new URL('card.html', import.meta.url));
const out = fileURLToPath(new URL('../social-preview.png', import.meta.url));

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
  await page.goto(`file://${card}`);
  // Draw nothing until the fonts are in, or the text lands in a fallback face.
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out, type: 'png' });
} finally {
  await browser.close();
}
console.log(`wrote ${out}`);
