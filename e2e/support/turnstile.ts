import { expect, type Page } from '@playwright/test';

/** Waits until Cloudflare's test widget has handed the page a token. */
export async function passTurnstile(page: Page): Promise<void> {
  await expect(page.locator('input[name="cf-turnstile-response"]')).toHaveValue(/.+/, {
    timeout: 15_000,
  });
}
