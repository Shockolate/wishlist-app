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
  const dirty = useRef(false);
  const titleButtons = useRef(new Map<string, HTMLButtonElement>());
  const focusAfterDelete = useRef<string | null>(null);
  const { announce, fail } = useListStatus();
  const remove = useListMutation(useListMutations().remove, fail);

  const setDirty = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);

  function toggle(id: string) {
    if (openId !== null && openId !== id && dirty.current) {
      announce(FINISH_EDITING, 'info');
      return;
    }
    dirty.current = false;
    setOpenId((current) => (current === id ? null : id));
  }

  function done(id: string) {
    dirty.current = false;
    setOpenId(null);
    titleButtons.current.get(id)?.focus();
  }

  function deleteItem(item: Item) {
    const index = items.findIndex((i) => i.id === item.id);
    focusAfterDelete.current = items[index + 1]?.id ?? items[index - 1]?.id ?? null;
    dirty.current = false;
    setOpenId(null);
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
          open={openId === item.id}
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
