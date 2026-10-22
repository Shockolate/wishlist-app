import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { passTurnstile } from './turnstile.js';

const WCAG_22_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
export const PHONE = { width: 390, height: 844 };
export const DESKTOP = { width: 1280, height: 800 };
const TURNSTILE_PAGES = new Set(['/signup', '/verify-email', '/reset-password']);

export async function expectAccessible(page: Page) {
  // A control that just changed is still fading (`transition-colors`), and axe would measure the
  // contrast of its colors halfway through. Endless animations, like a spinner, never finish, and
  // one cancelled by its element leaving the page has nothing left to wait for.
  await page.evaluate(() => {
    type Running = {
      finished: Promise<unknown>;
      effect: { getComputedTiming(): { endTime?: number } } | null;
    };
    const { document } = globalThis as unknown as { document: { getAnimations(): Running[] } };
    const ending = document
      .getAnimations()
      .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime));
    return Promise.all(ending.map((animation) => animation.finished.catch(() => undefined)));
  });
  // Cloudflare's widget is a third-party iframe whose markup we can't change.
  const results = await new AxeBuilder({ page })
    .withTags(WCAG_22_AA)
    .exclude('[data-turnstile]')
    .analyze();
  expect(results.violations).toEqual([]);
}

/**
 * Loads the page fresh at phone width (a resize of a loaded page would hide layout that only
 * breaks on first render), then measures sideways overflow. `networkidle` never settles on the
 * Turnstile pages, so a finished widget is the readiness signal there. (Its iframe sits in a
 * closed shadow root that locators can't reach, so we wait for the token.)
 */
export async function expectFitsPhone(page: Page, path: string) {
  await page.setViewportSize(PHONE);
  await page.goto(path);
  if (TURNSTILE_PAGES.has(path)) {
    await passTurnstile(page);
  }
  await expectNoSidewaysScroll(page);
}

/** Measures sideways overflow of the page as it is now, without navigating. */
export async function expectNoSidewaysScroll(page: Page) {
  // e2e has no DOM lib, so the page's globals are typed by hand.
  const overflow = await page.evaluate(() => {
    const { document, innerWidth } = globalThis as unknown as {
      document: { documentElement: { scrollWidth: number } };
      innerWidth: number;
    };
    return document.documentElement.scrollWidth - innerWidth;
  });
  expect(overflow, 'no sideways scrolling at 390px').toBeLessThanOrEqual(0);
}
