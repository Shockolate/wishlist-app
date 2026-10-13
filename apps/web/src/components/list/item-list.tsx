'use client';

import type { Item } from '@wishlist/contracts';
import { useCallback, useRef, useState } from 'react';
import { FINISH_EDITING } from '@/lib/messages';
import { ItemEditForm } from './item-edit-form';
import { ItemRow } from './item-row';
import { useListStatus } from './list-status';
import { useListMutation, useListMutations } from './use-list-mutations';

/** The rows, one open at a time (Plan 3b rule 8). */
export function ItemList({ items }: { items: Item[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  // What handlers (and a save that resolves later) must see, without waiting for a render.
  const openRef = useRef<string | null>(null);
  const dirty = useRef(false);
  const titleButtons = useRef(new Map<string, HTMLButtonElement>());
  const focusAfterDelete = useRef<string | null>(null);
  const { announce, fail } = useListStatus();
  const remove = useListMutation(useListMutations().remove, fail);

  // A refetch can remove the open item (deleted on another device); then no row is open.
  const open = openId !== null && items.some((i) => i.id === openId) ? openId : null;

  function openRow(id: string | null) {
    openRef.current = id;
    setOpenId(id);
  }

  const setDirty = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);

  function toggle(id: string) {
    if (open !== null && open !== id && dirty.current) {
      announce(FINISH_EDITING, 'info');
      return;
    }
    dirty.current = false;
    openRow(open === id ? null : id);
  }

  function done(id: string) {
    // A save that resolves after the person moved to another row mustn't close or refocus that one.
    if (openRef.current !== id) return;
    dirty.current = false;
    openRow(null);
    titleButtons.current.get(id)?.focus();
  }

  function deleteItem(item: Item) {
    const index = items.findIndex((i) => i.id === item.id);
    focusAfterDelete.current = items[index + 1]?.id ?? items[index - 1]?.id ?? null;
    dirty.current = false;
    openRow(null);
    remove.mutate(item.id);
    announce(`Deleted “${item.title}”.`);
  }

  function moveFocusAfterDelete() {
    const next = focusAfterDelete.current;
    (next ? titleButtons.current.get(next) : document.getElementById('add-box'))?.focus();
  }

  return (
    <ol
      aria-label="Your items, most wanted first"
      className="mt-5 overflow-hidden rounded-card border border-border bg-card"
    >
      {items.map((item) => (
        <ItemRow
          key={item.id}
          item={item}
          open={open === item.id}
          onToggle={() => toggle(item.id)}
          titleButtonRef={(button) => {
            if (button) titleButtons.current.set(item.id, button);
            else titleButtons.current.delete(item.id);
          }}
        >
          <ItemEditForm
            item={item}
            onDone={() => done(item.id)}
            onDelete={() => deleteItem(item)}
            onDeleteClosed={moveFocusAfterDelete}
            onDirtyChange={setDirty}
          />
        </ItemRow>
      ))}
    </ol>
  );
}
