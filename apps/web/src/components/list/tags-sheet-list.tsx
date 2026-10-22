'use client';

import type { Tag } from '@wishlist/contracts';
import { useRef, useState, type ReactNode, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { Button } from '@/components/ui/button';
import { SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { tagChipLabel } from '@/lib/share-copy';
import { itemCount } from '@/lib/tag-copy';
import { PlusIcon } from './icons';
import { useListStatus } from './list-status';
import { failUnlessName, tagNameError, TagNameForm } from './tag-name-form';
import { useListMutation, useListMutations } from './use-list-mutations';

/**
 * The Tags sheet's first pane (Ted's mockup 2a): every tag on the list, empty ones included,
 * alphabetically (values table), each a button that opens it; then New tag.
 */
export function AllTagsPane({
  tags,
  counts,
  title,
  rows,
  close,
  onOpen,
}: {
  tags: readonly Tag[];
  counts: ReadonlyMap<string, number>;
  title: RefObject<HTMLHeadingElement | null>;
  /** Each row's button by tag id, so going back can focus the tag just left. */
  rows: RefObject<Map<string, HTMLButtonElement>>;
  close: ReactNode;
  onOpen: (tagId: string) => void;
}) {
  const { fail } = useListStatus();
  const create = useListMutation(useListMutations().createTag, failUnlessName(fail));
  const [creating, setCreating] = useState(false);
  const newButton = useRef<HTMLButtonElement>(null);
  const sorted = [...tags].sort((a, b) => a.name.localeCompare(b.name));

  // A name the list already has answers 200 with that tag, so this opens it rather than a copy.
  const save = async (name: string) => {
    try {
      const tag = await create.mutateAsync(name);
      onOpen(tag.id);
      return undefined;
    } catch (error) {
      return tagNameError(error);
    }
  };

  const cancel = () => {
    // The button replaces the field; render it now so it can take focus.
    flushSync(() => setCreating(false));
    newButton.current?.focus();
  };

  return (
    <>
      <div className="flex items-start gap-2">
        <SheetTitle ref={title} tabIndex={-1} className="mt-1.5 flex-1">
          Tags
        </SheetTitle>
        {close}
      </div>
      <SheetDescription>
        {tags.length > 0 ? 'Tap a tag to choose its items.' : 'Make a tag, then choose its items.'}
      </SheetDescription>
      {sorted.length > 0 ? (
        <ul className="mt-3">
          {sorted.map((tag) => {
            const count = counts.get(tag.id) ?? 0;
            return (
              <li key={tag.id} className="border-b border-border">
                <button
                  type="button"
                  ref={(element) => {
                    if (element) rows.current.set(tag.id, element);
                    else rows.current.delete(tag.id);
                  }}
                  aria-label={tagChipLabel(tag.name, count)}
                  onClick={() => onOpen(tag.id)}
                  className="flex min-h-13 w-full items-center justify-between gap-3 px-1 text-left text-base font-medium"
                >
                  <span className="[overflow-wrap:anywhere]">{tag.name}</span>
                  <span className="shrink-0 text-sm font-normal text-muted-foreground">
                    {itemCount(count)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {creating ? (
        <TagNameForm
          id="new-tag-name"
          submitLabel="Add tag"
          pendingLabel="Adding…"
          save={save}
          onCancel={cancel}
        />
      ) : (
        <Button
          ref={newButton}
          variant="secondary"
          size="compact"
          className="mt-4"
          onClick={() => setCreating(true)}
        >
          <PlusIcon />
          New tag
        </Button>
      )}
    </>
  );
}
