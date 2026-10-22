import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { DESKTOP, PHONE } from '../../support/a11y.js';
import { addItemViaApi, verifiedOwner } from '../../support/owner.js';
import { guest, shareTokenOf } from '../../support/share.js';

/**
 * Where a sheet sits (components/ui/sheet.tsx). On a phone it rises from the bottom edge; in a
 * wider window a sheet flush on the bottom edge looks cut off, so from 640px it's a centered
 * dialog with a full border and rounded corners.
 */
async function placement(dialog: Locator) {
  // e2e has no DOM lib, so the page's globals are typed by hand.
  return dialog.evaluate((el) => {
    const scope = globalThis as unknown as {
      innerWidth: number;
      innerHeight: number;
      getComputedStyle: (node: unknown) => {
        borderBottomWidth: string;
        borderBottomLeftRadius: string;
      };
    };
    const box = (
      el as unknown as {
        getBoundingClientRect: () => { top: number; bottom: number; left: number; right: number };
      }
    ).getBoundingClientRect();
    const style = scope.getComputedStyle(el);
    return {
      top: box.top,
      gapBelow: scope.innerHeight - box.bottom,
      left: box.left,
      gapRight: scope.innerWidth - box.right,
      borderBottom: parseFloat(style.borderBottomWidth),
      cornerBottom: parseFloat(style.borderBottomLeftRadius),
    };
  });
}

async function openClaimSheet(page: Page, browser: Browser, base: string, label: string) {
  await verifiedOwner(page, base, label);
  await addItemViaApi(page.request, base, { title: 'Enamel kettle' });
  const token = await shareTokenOf(page.request);
  const gifter = await (await guest(browser, base)).newPage();
  return { gifter, token };
}

test('in a wide window the claim sheet is a centered dialog, not cut off at the bottom', async ({
  page,
  browser,
  baseURL,
}) => {
  const { gifter, token } = await openClaimSheet(page, browser, baseURL ?? '', 'sheet-wide');
  await gifter.setViewportSize(DESKTOP);
  await gifter.goto(`/s/${token}`);
  await gifter.getByRole('button', { name: 'I’ll get this' }).click();
  const at = await placement(gifter.getByRole('dialog', { name: 'Enamel kettle' }));
  expect(at.gapBelow).toBeGreaterThan(16);
  expect(at.top).toBeGreaterThan(16);
  expect(Math.abs(at.left - at.gapRight)).toBeLessThanOrEqual(1);
  expect(at.borderBottom).toBeGreaterThan(0);
  expect(at.cornerBottom).toBeGreaterThan(0);
});

test('on a phone the claim sheet still rises from the bottom edge', async ({
  page,
  browser,
  baseURL,
}) => {
  const { gifter, token } = await openClaimSheet(page, browser, baseURL ?? '', 'sheet-phone');
  await gifter.setViewportSize(PHONE);
  await gifter.goto(`/s/${token}`);
  await gifter.getByRole('button', { name: 'I’ll get this' }).click();
  const at = await placement(gifter.getByRole('dialog', { name: 'Enamel kettle' }));
  expect(Math.abs(at.gapBelow)).toBeLessThanOrEqual(1);
  expect(at.cornerBottom).toBe(0);
});

test('in a wide window the Tags sheet is a centered dialog too', async ({ page, baseURL }) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'sheet-tags-wide');
  await addItemViaApi(page.request, base, { title: 'Stream deck', tags: [{ name: 'PC parts' }] });
  await page.setViewportSize({ width: 788, height: 940 });
  await page.goto('/list');
  await page.getByRole('button', { name: 'Tags', exact: true }).click();
  const at = await placement(page.getByRole('dialog'));
  expect(at.gapBelow).toBeGreaterThan(16);
  expect(Math.abs(at.left - at.gapRight)).toBeLessThanOrEqual(1);
  expect(at.borderBottom).toBeGreaterThan(0);
  expect(at.cornerBottom).toBeGreaterThan(0);
});

test('a button under a resting pointer holds still, even at its bottom edge', async ({
  page,
  browser,
  baseURL,
}) => {
  // The hover lift moves a button up 1px. Without a hit area that fills the gap below it, a pointer
  // resting on the bottom edge would hover, lift the edge off itself, unhover and drop again,
  // every frame: the claim sheet's "Back to …" did, under the pointer that just pressed Claim it.
  const { gifter, token } = await openClaimSheet(page, browser, baseURL ?? '', 'button-edge');
  await gifter.setViewportSize(DESKTOP);
  await gifter.goto(`/s/${token}`);
  // A borderless (primary) and a bordered (secondary) button: the border moves where the gap is.
  await expectStillUnderPointer(gifter, gifter.getByRole('button', { name: 'I’ll get this' }));
  await page.setViewportSize(DESKTOP);
  await page.goto('/list');
  await expectStillUnderPointer(page, page.getByRole('button', { name: 'Copy share link' }));
});

/** Rests the pointer just inside, then just below, the button's bottom edge: it must not move. */
async function expectStillUnderPointer(page: Page, button: Locator) {
  const box = await button.boundingBox();
  if (!box) throw new Error('no button');
  for (const offset of [-0.5, 0.5]) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height + offset);
    const tops = await button.evaluate(async (el) => {
      // e2e has no DOM lib, so the page's globals are typed by hand.
      const scope = globalThis as unknown as { requestAnimationFrame: (cb: () => void) => void };
      const node = el as unknown as { getBoundingClientRect: () => { top: number } };
      const seen: number[] = [];
      for (let frame = 0; frame < 10; frame++) {
        await new Promise<void>((done) => scope.requestAnimationFrame(() => done()));
        seen.push(node.getBoundingClientRect().top);
      }
      return seen;
    });
    expect(new Set(tops).size, `pointer ${offset}px from the bottom edge`).toBe(1);
  }
}
