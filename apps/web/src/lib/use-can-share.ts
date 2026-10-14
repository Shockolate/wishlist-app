'use client';

import { useSyncExternalStore } from 'react';

const nothingToWatch = () => () => undefined;

/** Whether this browser can open the system share sheet. False while rendering on the server. */
export function useCanShare(): boolean {
  return useSyncExternalStore(
    nothingToWatch,
    () => typeof navigator.share === 'function',
    () => false,
  );
}
