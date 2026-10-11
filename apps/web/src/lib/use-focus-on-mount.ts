import { useEffect, useRef } from 'react';

/**
 * A ref whose element takes focus when it mounts. Use it on the heading (or the notice) of content
 * that replaces a form, so keyboard and screen-reader users land on what changed.
 */
export function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}
