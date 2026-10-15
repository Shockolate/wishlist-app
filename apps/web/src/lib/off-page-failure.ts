import { useSyncExternalStore } from 'react';

// A list change keeps going when the owner leaves /list, but the editor that would say it failed
// has gone, and so have its mutate() callbacks. The mutation cache reports the failure here, and
// the account header shows it (Plan 4b rule 14).

let editors = 0;
let unseen = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** A list change failed. Kept only when no editor is on screen to say so. */
export function reportListFailure(): void {
  if (editors > 0 || unseen) return;
  unseen = true;
  notify();
}

/** The editor is on screen: it reports its own failures, and stands in for any from before. */
export function editorShown(): () => void {
  editors += 1;
  if (unseen) {
    unseen = false;
    notify();
  }
  return () => {
    editors -= 1;
  };
}

export function hasUnseenListFailure(): boolean {
  return unseen;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useUnseenListFailure(): boolean {
  return useSyncExternalStore(subscribe, hasUnseenListFailure, () => false);
}
