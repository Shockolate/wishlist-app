'use client';

import { useQueryClient } from '@tanstack/react-query';
import type { ItemTagRef, Tag, WishlistResponse } from '@wishlist/contracts';
import {
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type Ref,
} from 'react';
import { Controller } from 'react-hook-form';
import { Field, type FieldControlProps } from '@/components/ui/field';
import { WISHLIST_KEY } from '@/lib/list-cache';
import { addPendingTags, addTypedTag, liveTags, shownTags, suggestTags } from '@/lib/tag-input';
import { cn } from '@/lib/utils';
import { CloseIcon } from './icons';
import type { ItemForm } from './item-fields';

const NO_TAGS: readonly Tag[] = [];

/** What a form asks of the tag field before it saves. */
export interface TagBox {
  /**
   * Adds the text left in the box, as Enter would. False when it's refused: the error is on the
   * field, focus is in the box, and the save should wait.
   */
  addTyped: () => boolean;
}

/**
 * Every tag on the owner's own list, empty ones included, from the editor's cache (Ledger ruling
 * 6). It reads the cache rather than adding a second `useQuery` on the key: an observer's options
 * become the query's, and this one has no fetch of its own to give.
 */
export function useListTags(): readonly Tag[] {
  const client = useQueryClient();
  const subscribe = useCallback(
    (onChange: () => void) => client.getQueryCache().subscribe(onChange),
    [client],
  );
  const read = () => client.getQueryData<WishlistResponse>(WISHLIST_KEY);
  return useSyncExternalStore(subscribe, read, read)?.tags ?? NO_TAGS;
}

/** The item form's Tags field (design §4): chips, then a combobox that suggests the list's tags. */
export function TagField({
  form,
  id,
  handle,
}: {
  form: ItemForm;
  id: string;
  handle?: Ref<TagBox> | undefined;
}) {
  const all = useListTags();
  return (
    <Controller
      control={form.control}
      name="tags"
      render={({ field, fieldState }) => (
        <TagCombobox
          id={id}
          handle={handle}
          all={all}
          value={field.value ?? []}
          onChange={field.onChange}
          onBlur={field.onBlur}
          inputRef={field.ref}
          fieldError={fieldState.error?.message}
        />
      )}
    />
  );
}

function TagCombobox({
  id,
  handle,
  all,
  value,
  onChange,
  onBlur,
  inputRef,
  fieldError,
}: {
  id: string;
  handle: Ref<TagBox> | undefined;
  all: readonly Tag[];
  value: readonly ItemTagRef[];
  onChange: (tags: ItemTagRef[]) => void;
  onBlur: () => void;
  inputRef: (element: HTMLInputElement | null) => void;
  fieldError: string | undefined;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement | null>(null);
  const chipRow = useRef<HTMLDivElement | null>(null);

  // A chip whose tag was deleted meanwhile is neither shown nor kept (ruling 6).
  const live = liveTags(value, all);
  const chips = shownTags(value, all);
  const offered = suggestTags(all, text, live);
  const suggestions = open ? offered : [];
  const expanded = suggestions.length > 0;
  const highlighted = active < suggestions.length ? active : -1;
  const listId = `${id}-suggestions`;
  const optionId = (index: number) => `${id}-option-${String(index)}`;

  const close = () => {
    setOpen(false);
    setActive(-1);
  };

  /** The chosen tags as `tags`, through the field's onChange so it's dirty, unless nothing changed. */
  const keep = (tags: readonly ItemTagRef[]) => {
    // A tag it already has changes nothing, and so shouldn't mark the field dirty.
    if (tags.length !== live.length) onChange([...tags]);
  };

  /**
   * Adds typed text, comma by comma, as Enter would. Returns what's left of it: '' once it's all
   * added, else the text from the part refused on, with the reason on the field.
   */
  const commit = (typed: string): string => {
    const result = addPendingTags(live, typed, all);
    keep(result.tags);
    if (result.error !== undefined) setError(result.error);
    return result.left;
  };

  /** Adds a suggestion whole: an existing tag's name may hold a comma. */
  const pickSuggestion = (tag: Tag) => {
    const result = addTypedTag(live, tag.name, all);
    if ('error' in result) setError(result.error);
    else {
      keep(result.tags);
      setText('');
    }
    close();
  };

  useImperativeHandle(handle, () => ({
    addTyped: () => {
      const left = commit(text);
      setText(left);
      close();
      if (left === '') return true;
      input.current?.focus();
      return false;
    },
  }));

  const onType = (raw: string) => {
    setError(undefined);
    setActive(-1);
    // A comma from a phone's keyboard, or in pasted text, arrives here rather than as a key press.
    const parts = raw.split(',');
    const rest = parts.pop() ?? '';
    const left = commit(parts.join(','));
    const next = left === '' ? rest : `${left},${rest}`;
    setText(next);
    setOpen(left === '' && next.trim() !== '');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // While an input method composes (Japanese, Chinese, Korean), ↑/↓ choose its candidates and
    // Enter confirms one: none of them is meant for the field. 229 is what Safari sends instead.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const last = offered.length - 1;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (last < 0) return;
        const down = event.key === 'ArrowDown';
        setOpen(true);
        if (!expanded || highlighted < 0) setActive(down ? 0 : last);
        else if (down) setActive(highlighted === last ? 0 : highlighted + 1);
        else setActive(highlighted === 0 ? last : highlighted - 1);
        return;
      }
      case 'Enter':
      case ',': {
        const choice = highlighted >= 0 ? suggestions[highlighted] : undefined;
        // Enter in an empty box sends the form, as in every other field.
        if (!choice && text === '' && event.key === 'Enter') return;
        event.preventDefault();
        if (choice) pickSuggestion(choice);
        else if (text.trim() === '') setText('');
        else {
          setText(commit(text));
          close();
        }
        return;
      }
      case 'Escape':
        if (!expanded) return;
        event.preventDefault();
        close();
        return;
      case 'Backspace': {
        if (text !== '' || chips.length === 0) return;
        // Focus the last chip's remove button rather than deleting without a word (design §4).
        event.preventDefault();
        const buttons = chipRow.current?.querySelectorAll<HTMLButtonElement>('[data-remove]');
        buttons?.[buttons.length - 1]?.focus();
        return;
      }
    }
  };

  const remove = (ref: ItemTagRef) => {
    setError(undefined);
    onChange(live.filter((each) => each !== ref));
    // The button is about to unmount; keep focus in the field.
    input.current?.focus();
  };

  return (
    <Field
      id={id}
      label="Tags"
      hint="Gifters can filter your list by these."
      error={error ?? fieldError}
    >
      {(props: FieldControlProps) => (
        <div>
          <div
            ref={chipRow}
            className={cn(
              'flex min-h-12 flex-wrap items-center gap-1.5 rounded-control border-[1.5px] border-input bg-card px-2 py-1.5',
              'has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-3 has-[input:focus-visible]:outline-ring',
              props['aria-invalid'] && 'border-destructive',
            )}
          >
            {chips.map(({ ref, name }) => (
              <span
                key={'id' in ref ? ref.id : `new:${name}`}
                className="inline-flex max-w-full min-h-8 items-center gap-0.5 rounded-full bg-placeholder pr-0.5 pl-3 text-[15px] font-medium text-foreground"
              >
                <span className="[overflow-wrap:anywhere]">{name}</span>
                <button
                  type="button"
                  data-remove
                  aria-label={`Remove ${name}`}
                  onClick={() => remove(ref)}
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-full hover:bg-foreground/10"
                >
                  <CloseIcon />
                </button>
              </span>
            ))}
            <input
              {...props}
              ref={(element) => {
                input.current = element;
                inputRef(element);
              }}
              role="combobox"
              aria-expanded={expanded}
              aria-controls={expanded ? listId : undefined}
              aria-activedescendant={highlighted >= 0 ? optionId(highlighted) : undefined}
              aria-autocomplete="list"
              autoComplete="off"
              value={text}
              onChange={(event) => onType(event.target.value)}
              onKeyDown={onKeyDown}
              onBlur={() => {
                close();
                onBlur();
              }}
              className="h-9 min-w-[10ch] flex-1 bg-transparent px-1.5 text-[17px] text-foreground focus-visible:outline-none"
            />
          </div>
          {expanded ? (
            <ul
              id={listId}
              role="listbox"
              aria-label="Tag suggestions"
              className="mt-1.5 rounded-control border-[1.5px] border-input bg-card py-1"
            >
              {suggestions.map((tag, index) => (
                // The box keeps focus (aria-activedescendant); a press here mustn't take it.
                <li
                  key={tag.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === highlighted}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pickSuggestion(tag)}
                  className={cn(
                    'cursor-pointer px-3.5 py-2.5 text-[17px] [overflow-wrap:anywhere]',
                    index === highlighted && 'bg-foreground text-background',
                  )}
                >
                  {tag.name}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </Field>
  );
}
