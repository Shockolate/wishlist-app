import { expect, test, type Page, type Route } from '@playwright/test';
import { addItemViaApi, verifiedOwner } from '../../support/owner.js';

// When a request fails and the control that was pressed has gone (disabled, or removed by the
// refetch), focus must land on the error, not fall to <body> (WCAG 2.4.3; final review, I2).

const SOMETHING_WRONG = 'Something went wrong on our side. Try again in a moment.';

const serverError = (route: Route) =>
  route.fulfill({
    status: 500,
    contentType: 'application/problem+json',
    body: JSON.stringify({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      code: 'INTERNAL_ERROR',
      requestId: 'e2e',
    }),
  });

const errorNotice = (page: Page) => page.getByRole('alert').filter({ hasText: SOMETHING_WRONG });

async function whereIsFocus(page: Page): Promise<string> {
  return page.evaluate(() => {
    const { document } = globalThis as unknown as {
      document: {
        activeElement: { tagName: string; textContent: string | null; role?: string } | null;
      };
    };
    const active = document.activeElement;
    if (active === null || active.tagName === 'BODY') return 'the page';
    if (active.textContent?.startsWith('Something went wrong')) return 'the error';
    return active.tagName === 'BUTTON' && active.textContent === 'Add'
      ? 'the Add button'
      : `${active.tagName} ${active.textContent ?? ''}`;
  });
}

test('a failed add of an idea puts focus on the error', async ({ page, baseURL }) => {
  await verifiedOwner(page, baseURL ?? '', 'focus-add');
  await page.goto('/list');
  await page.route('**/api/wishlist/items', (route) =>
    route.request().method() === 'POST' ? serverError(route) : route.fallback(),
  );
  await page.getByLabel('Add to your list').fill('Pottery class');
  const add = page.getByRole('button', { name: 'Add', exact: true });
  await add.click();
  await expect(errorNotice(page)).toBeVisible();
  // The button disables itself while the request runs. Whether the browser drops focus from it in
  // that blink depends on whether a frame was rendered meanwhile; if not, focus is still on the
  // button, which is a fine place for it. What must not happen is focus falling to <body>.
  await expect(add).toBeEnabled();
  await expect.poll(() => whereIsFocus(page)).toMatch(/^(the error|the Add button)$/);
});

test('a failed add from the form puts focus on the error', async ({ page, baseURL }) => {
  await verifiedOwner(page, baseURL ?? '', 'focus-add-form');
  await page.goto('/list');
  await page.route('**/api/wishlist/items', (route) =>
    route.request().method() === 'POST' ? serverError(route) : route.fallback(),
  );
  await page.getByLabel('Add to your list').fill('https://hanker-e2e.invalid/kettle');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Kettle');
  await page.getByRole('button', { name: 'Add to list' }).click();
  await expect(errorNotice(page)).toBeVisible();
  await expect(errorNotice(page)).toBeFocused();
});

test('a failed save puts focus on the error', async ({ page, baseURL }) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'focus-save');
  await addItemViaApi(page.request, base, { title: 'Kettle' });
  await page.goto('/list');
  await page.route('**/api/wishlist/items/*', (route) =>
    route.request().method() === 'PATCH' ? serverError(route) : route.fallback(),
  );
  await page.getByRole('button', { name: /^Kettle/ }).click();
  await page.getByLabel('Title').fill('Kettle, blue');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(errorNotice(page)).toBeVisible();
  await expect(errorNotice(page)).toBeFocused();
});

test('a failed move with an arrow puts focus on the error', async ({ page, baseURL }) => {
  const base = baseURL ?? '';
  await verifiedOwner(page, base, 'focus-move');
  await addItemViaApi(page.request, base, { title: 'A' });
  await addItemViaApi(page.request, base, { title: 'B' });
  await page.goto('/list');
  await page.route('**/api/wishlist/items/order', serverError);
  await page.getByRole('button', { name: 'Move “B” up' }).click();
  await expect(errorNotice(page)).toBeVisible();
  // The refetch puts B back below A. Wait for it, since that re-render is what drops focus.
  await expect(page.getByRole('listitem').first()).toContainText('A');
  await expect(errorNotice(page)).toBeFocused();
});

test('a failed account deletion puts focus on the error in the dialog', async ({
  page,
  baseURL,
}) => {
  await verifiedOwner(page, baseURL ?? '', 'focus-delete');
  await page.goto('/settings');
  await page.route('**/api/me', (route) =>
    route.request().method() === 'DELETE' ? serverError(route) : route.fallback(),
  );
  await page.getByRole('button', { name: 'Delete account' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete your account?' });
  await dialog.getByLabel('Your password').fill('whatever password');
  await dialog.getByRole('button', { name: 'Delete account' }).click();
  await expect(dialog.getByRole('alert').filter({ hasText: SOMETHING_WRONG })).toBeFocused();
});
