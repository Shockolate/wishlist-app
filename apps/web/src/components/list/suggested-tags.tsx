'use client';

import type { ItemTagRef, Tag } from '@wishlist/contracts';
import { useEffect, useRef } from 'react';
import { useWatch } from 'react-hook-form';
import { addSuggestedTag, openSuggestions } from '@/lib/tag-input';
import { cn } from '@/lib/utils';
import type { ItemForm } from './item-fields';
import { useListTags } from './tag-field';

/** A suggestion with the name to show and a key that is stable while the row changes. */
interface Chip {
  ref: ItemTagRef;
  name: string;
  key: string;
  isNew: boolean;
}

/** The chip for a suggestion: an `{ id }` the list doesn't hold has no name to show, so it has none. */
function chipOf(ref: ItemTagRef, all: readonly Tag[]): Chip | undefined {
  if ('name' in ref) return { ref, name: ref.name, key: `new:${ref.name}`, isNew: true };
  const known = all.find((tag) => tag.id === ref.id);
  return known ? { ref, name: known.name, key: ref.id, isNew: false } : undefined;
}

/**
 * The "Suggested:" row under the Tags field (tag suggestions design §5.1): dashed chips, each a
 * button that adds its tag as picking it from the combobox would, and leaves the row. Whatever is
 * left is simply not saved. Nothing is rendered while there is nothing to offer, or the title is
 * blank, so a cleared title never shows suggestions made for the old one.
 */
export function SuggestedTags({
  form,
  suggestions,
  tagInputId,
}: {
  form: ItemForm;
  suggestions: ItemTagRef[];
  tagInputId: string;
}) {
  const all = useListTags();
  const title = useWatch({ control: form.control, name: 'title' });
  const chosen = useWatch({ control: form.control, name: 'tags' }) ?? [];
  const group = useRef<HTMLDivElement>(null);
  // Where focus goes once the tapped chip has left the row: a chip's key, or the tag input.
  const focusNext = useRef<string | null>(null);

  const chips =
    title.trim() === ''
      ? []
      : openSuggestions(suggestions, chosen, all).flatMap((ref) => chipOf(ref, all) ?? []);

  // After every render, so it runs once the tap's new tags have rendered; a ref, since asking for
  // focus isn't something to draw.
  useEffect(() => {
    const key = focusNext.current;
    if (key === null) return;
    focusNext.current = null;
    const next = Array.from(group.current?.querySelectorAll<HTMLElement>('[data-chip]') ?? []).find(
      (button) => button.dataset['chip'] === key,
    );
    if (next) next.focus();
    else document.getElementById(tagInputId)?.focus();
  });

  if (chips.length === 0) return null;

  const pick = (chip: Chip, index: number) => {
    const tags = addSuggestedTag(form.getValues('tags') ?? [], chip.ref, all);
    // shouldDirty: the edit form sends `tags` only when the field is dirty (Plan 7b ruling 5).
    form.setValue('tags', tags, { shouldDirty: true });
    // The chip leaves the row; focus goes to the one that takes its place, else the last, else the input.
    const rest = chips.filter((each) => each !== chip);
    focusNext.current = rest[Math.min(index, rest.length - 1)]?.key ?? '';
  };

  return (
    <div
      ref={group}
      role="group"
      aria-label="Suggested tags"
      className="flex flex-wrap items-center gap-1.5"
    >
      <span aria-hidden="true" className="text-sm text-muted-foreground">
        Suggested:
      </span>
      {chips.map((chip, index) => (
        // The "new" marker sits beside the button, over its padding, not inside it. Inside, it would
        // be visible text that the accessible name ("Add new tag Coffee") doesn't contain, which
        // WCAG 2.5.3 (label in name) forbids. pointer-events-none lets a press on it reach the button.
        <span
          key={chip.key}
          className="relative inline-flex max-w-full rounded-full border-[1.5px] border-dashed border-input hover:bg-placeholder has-[button:focus-visible]:outline-2 has-[button:focus-visible]:outline-offset-3 has-[button:focus-visible]:outline-ring"
        >
          <button
            type="button"
            data-chip={chip.key}
            aria-label={chip.isNew ? `Add new tag ${chip.name}` : `Add tag ${chip.name}`}
            onClick={() => pick(chip, index)}
            className={cn(
              'min-h-8 max-w-full rounded-full px-3 text-[15px] font-medium text-foreground focus-visible:outline-none',
              chip.isNew && 'pr-11',
            )}
          >
            <span aria-hidden="true">+ </span>
            <span className="[overflow-wrap:anywhere]">{chip.name}</span>
          </button>
          {chip.isNew ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground"
            >
              new
            </span>
          ) : null}
        </span>
      ))}
    </div>
  );
}
