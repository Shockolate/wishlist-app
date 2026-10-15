import { beforeEach, describe, expect, it, vi } from 'vitest';

// The store is module state, so each test loads a fresh copy.
let store: typeof import('./off-page-failure');
beforeEach(async () => {
  vi.resetModules();
  store = await import('./off-page-failure');
});

describe('a list change that fails off-page (Plan 4b rule 14)', () => {
  it('is kept when the editor isn’t on screen', () => {
    store.reportListFailure();
    expect(store.hasUnseenListFailure()).toBe(true);
  });

  it('is ignored while the editor is on screen: it says so itself', () => {
    const hide = store.editorShown();
    store.reportListFailure();
    expect(store.hasUnseenListFailure()).toBe(false);
    hide();
    store.reportListFailure();
    expect(store.hasUnseenListFailure()).toBe(true);
  });

  it('is cleared once the editor is shown again', () => {
    store.reportListFailure();
    store.editorShown();
    expect(store.hasUnseenListFailure()).toBe(false);
  });
});
