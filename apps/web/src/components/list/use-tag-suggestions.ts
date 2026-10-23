'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  TagSuggestionsResponseSchema,
  type ItemTagRef,
  type WishlistResponse,
} from '@wishlist/contracts';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { browserApi } from '@/lib/browser-api';
import { WISHLIST_KEY } from '@/lib/list-cache';
import { SuggestionAsker, suggestionRequest, type Unfurled } from '@/lib/tag-suggestions';
import type { ItemForm } from './item-fields';

/**
 * Whether tag suggestions are on, from the editor's cache. Only `suggestTags === true` counts, so a
 * web build ahead of its API (the field absent) asks for nothing (Plan 9 ruling 9). Like
 * `useListTags`, it reads the cache rather than adding an observer on the key.
 */
export function useSuggestTagsOn(): boolean {
  const client = useQueryClient();
  const subscribe = useCallback(
    (onChange: () => void) => client.getQueryCache().subscribe(onChange),
    [client],
  );
  const read = () => client.getQueryData<WishlistResponse>(WISHLIST_KEY);
  return useSyncExternalStore(subscribe, read, read)?.suggestTags === true;
}

export interface TagSuggestions {
  suggestions: ItemTagRef[];
  /** Call from the title field's blur (Plan 9 ruling 2). */
  onTitleBlur: () => void;
}

/**
 * Suggested tags for the item in `form` (tag suggestions design §5.1). It asks once on mount and
 * again from `onTitleBlur`; `SuggestionAsker` skips an empty or unchanged title, so a note edit
 * never re-asks. The request is built from the form when it is sent. `unfurled` is the link's
 * unfurled description, which isn't a form field, and the link it came from: the description is
 * sent only while the form's link is still that one.
 */
export function useTagSuggestions(form: ItemForm, unfurled: Unfurled): TagSuggestions {
  const on = useSuggestTagsOn();
  const [suggestions, setSuggestions] = useState<ItemTagRef[]>([]);
  const asker = useRef<SuggestionAsker | undefined>(undefined);
  // The latest form and unfurl, read when asking rather than captured by the effect below.
  const latest = useRef({ form, unfurled });
  const { url, description } = unfurled;
  // Declared before the effect that asks on mount, so that one sees the committed values.
  useEffect(() => {
    latest.current = { form, unfurled: { url, description } };
  });

  const ask = useCallback(() => {
    asker.current?.ask(requestFrom(latest.current));
  }, []);

  useEffect(() => {
    if (!on) return;
    const next = new SuggestionAsker(
      (body, signal) =>
        browserApi.post('/wishlist/tag-suggestions', body, TagSuggestionsResponseSchema, {
          signal,
        }),
      setSuggestions,
    );
    asker.current = next;
    next.ask(requestFrom(latest.current));
    return () => {
      next.dispose();
      asker.current = undefined;
      setSuggestions([]);
    };
  }, [on]);

  return { suggestions: on ? suggestions : [], onTitleBlur: ask };
}

function requestFrom({ form, unfurled }: { form: ItemForm; unfurled: Unfurled }) {
  return suggestionRequest(form.getValues(), unfurled);
}
