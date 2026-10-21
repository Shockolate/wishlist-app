'use client';

import type { Item, Tag } from '@wishlist/contracts';
import { useRef, useState, type ReactNode, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { deleteTagTitle, itemCount } from '@/lib/tag-copy';
import { ArrowLeftIcon } from './icons';
import { useListStatus } from './list-status';
import { failUnlessName, tagNameError, TagNameForm } from './tag-name-form';
import { useListMutation, useListMutations } from './use-list-mutations';

/**
 * The Tags sheet's one-tag pane (Ted's mockups 2b and 2c): the tag, its count, Rename and Delete,
 * then every item in list order as a checkbox. A tick, an untick and a delete show at once; a
 * rename waits for the API, which decides the name that sticks (ruling 4).
 */
export function TagPane({
  tag,
  items,
  count,
  title,
  close,
  onBack,
  onDeleted,
}: {
  tag: Tag;
  items: readonly Item[];
  count: number;
  title: RefObject<HTMLHeadingElement | null>;
  close: ReactNode;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const { announce, fail } = useListStatus();
  const mutations = useListMutations();
  const tick = useListMutation(mutations.tick, fail);
  const untick = useListMutation(mutations.untick, fail);
  const remove = useListMutation(mutations.deleteTag, fail);
  const rename = useListMutation(mutations.renameTagTo, failUnlessName(fail));
  const [renaming, setRenaming] = useState(false);
  const renameButton = useRef<HTMLButtonElement>(null);
  // Set when Delete is confirmed: the sheet moves focus on, so the dialog mustn't return it.
  const deleting = useRef(false);

  // A press shows at once. The cache takes the tick a moment later, once a refetch in flight is
  // cancelled and TanStack notifies, and a controlled box would spring back until then. Presses are
  // kept against the `items` they were made on: the next items (the tick itself, or a refetch's
  // rollback) supersede them.
  const [pressed, setPressed] = useState<{
    on: ReadonlyMap<string, boolean>;
    items: readonly Item[];
  }>({ on: new Map(), items });
  const isTicked = (item: Item) =>
    (pressed.items === items ? pressed.on.get(item.id) : undefined) ??
    item.tagIds?.includes(tag.id) ??
    false;

  const toggle = (item: Item, on: boolean) => {
    setPressed((last) => ({
      on: new Map(last.items === items ? last.on : []).set(item.id, on),
      items,
    }));
    (on ? tick : untick).mutate({ tagId: tag.id, itemId: item.id });
    announce(on ? `Tagged “${item.title}”.` : `Untagged “${item.title}”.`);
  };

  // The title or Rename replaces the field; render it now so it can take focus.
  const stopRenaming = (focus: () => HTMLElement | null) => {
    flushSync(() => setRenaming(false));
    focus()?.focus();
  };

  const save = async (name: string) => {
    if (name === tag.name) {
      stopRenaming(() => title.current);
      return undefined;
    }
    try {
      await rename.mutateAsync({ id: tag.id, name });
      stopRenaming(() => title.current);
      return undefined;
    } catch (error) {
      // On 409 TAG_NAME_TAKEN the tag keeps its old name: a rename changes the cache only once
      // the API has taken it.
      return tagNameError(error);
    }
  };

  const confirmDelete = () => {
    deleting.current = true;
    remove.mutate(tag.id);
    announce(`Deleted “${tag.name}”.`);
    onDeleted();
  };

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <Button variant="link" size="compact" className="px-0" onClick={onBack}>
          <ArrowLeftIcon />
          All tags
        </Button>
        {close}
      </div>
      {renaming ? (
        <>
          {/* The dialog keeps its name while the field stands in for the title. */}
          <SheetTitle className="sr-only">{tag.name}</SheetTitle>
          <TagNameForm
            id="rename-tag-name"
            initial={tag.name}
            submitLabel="Save"
            pendingLabel="Saving…"
            save={save}
            onCancel={() => stopRenaming(() => renameButton.current)}
          />
        </>
      ) : (
        <SheetTitle ref={title} tabIndex={-1}>
          {tag.name}
        </SheetTitle>
      )}
      <SheetDescription>{itemCount(count)}</SheetDescription>
      {renaming ? null : (
        <div className="mt-1 flex flex-wrap gap-5">
          <Button
            ref={renameButton}
            variant="link"
            size="compact"
            className="px-0"
            onClick={() => setRenaming(true)}
          >
            Rename
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="link" size="compact" className="px-0 text-destructive">
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent
              onCloseAutoFocus={(event) => {
                if (deleting.current) event.preventDefault();
              }}
            >
              <AlertDialogTitle>{deleteTagTitle(tag.name, count)}</AlertDialogTitle>
              <AlertDialogDescription>The items stay on your list.</AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={confirmDelete}>Delete tag</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
      <ul className="mt-2">
        {items.map((item) => (
          <li key={item.id} className="border-b border-border">
            <label className="flex min-h-13 cursor-pointer items-center gap-3 px-1 text-base">
              <input
                type="checkbox"
                checked={isTicked(item)}
                onChange={(event) => toggle(item, event.target.checked)}
                className="size-5 shrink-0 accent-foreground"
              />
              <span className="[overflow-wrap:anywhere]">{item.title}</span>
            </label>
          </li>
        ))}
      </ul>
    </>
  );
}
