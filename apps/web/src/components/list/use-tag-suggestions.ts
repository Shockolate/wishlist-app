'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  DESCRIPTION_MAX,
  TagSuggestionsResponseSchema,
  type ItemTagRef,
  type TagSuggestionsRequest,
  type WishlistResponse,
} from '@wishlist/contracts';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { browserApi } from '@/lib/browser-api';
import { WISHLIST_KEY } from '@/lib/list-cache';
import { SuggestionAsker } from '@/lib/tag-suggestions';
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
 * never re-asks. The request is built from the form when it is sent. `extra.description` is the
 * link's unfurled description, which isn't a form field.
 */
export function useTagSuggestions(form: ItemForm, extra: { description?: string }): TagSuggestions {
  const on = useSuggestTagsOn();
  const [suggestions, setSuggestions] = useState<ItemTagRef[]>([]);
  const asker = useRef<SuggestionAsker | undefined>(undefined);
  // The latest form and description, read when asking rather than captured by the effect below.
  const latest = useRef({ form, description: extra.description });
  const { description } = extra;
  // Declared before the effect that asks on mount, so that one sees the committed values.
  useEffect(() => {
    latest.current = { form, description };
  });

  const ask = useCallback(() => {
    asker.current?.ask(requestFrom(latest.current.form, latest.current.description));
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
    next.ask(requestFrom(latest.current.form, latest.current.description));
    return () => {
      next.dispose();
      asker.current = undefined;
      setSuggestions([]);
    };
  }, [on]);

  return { suggestions: on ? suggestions : [], onTitleBlur: ask };
}

/** The request for what the form holds now: empty note and link are left out, `tagIds` are the `{ id }` tags. */
function requestFrom(form: ItemForm, description: string | undefined): TagSuggestionsRequest {
  const { title, note, url, tags } = form.getValues();
  const tagIds = (tags ?? []).flatMap((ref) => ('id' in ref ? [ref.id] : []));
  return {
    title,
    ...(note?.trim() ? { note } : {}),
    ...(url?.trim() ? { url } : {}),
    ...(description ? { description: description.slice(0, DESCRIPTION_MAX) } : {}),
    ...(tagIds.length > 0 ? { tagIds } : {}),
  };
}
