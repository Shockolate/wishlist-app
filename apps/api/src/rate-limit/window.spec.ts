import { describe, expect, it } from 'vitest';
import { fixedWindow } from './window.js';

describe('fixedWindow', () => {
  it('aligns the window start to a multiple of the window length', () => {
    expect(fixedWindow(125_000, 60)).toEqual({ start: new Date(120_000), retryAfterSeconds: 55 });
  });

  it('starts a fresh window exactly on the boundary', () => {
    expect(fixedWindow(120_000, 60)).toEqual({ start: new Date(120_000), retryAfterSeconds: 60 });
  });

  it('rounds the remaining time up to whole seconds', () => {
    expect(fixedWindow(179_500, 60).retryAfterSeconds).toBe(1);
  });
});
