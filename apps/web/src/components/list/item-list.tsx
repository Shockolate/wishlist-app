'use client';

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { Item } from '@wishlist/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  const move = useListMutation(useListMutations().move, fail);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const arrowButtons = useRef(new Map<string, HTMLButtonElement>());
  // The arrow to focus once a move has rendered. React moves a row's DOM node with insertBefore,
  // and a focused element that's removed and reinserted loses focus.
  const arrowToFocus = useRef<string | null>(null);

  useEffect(() => {
    const key = arrowToFocus.current;
    if (!key) return;
    arrowToFocus.current = null;
    arrowButtons.current.get(key)?.focus();
  }, [items]);

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

  /** One place up or down. Focus stays on the arrow pressed, or the other one if it's now disabled. */
  function moveBy(item: Item, index: number, step: -1 | 1) {
    const toIndex = index + step;
    const way =
      toIndex === 0 ? 'down' : toIndex === items.length - 1 ? 'up' : step < 0 ? 'up' : 'down';
    arrowToFocus.current = `${item.id}:${way}`;
    move.mutate({ id: item.id, toIndex });
    announce(
      `Moved “${item.title}” to position ${String(toIndex + 1)} of ${String(items.length)}.`,
    );
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const toIndex = items.findIndex((item) => item.id === over.id);
    if (toIndex !== -1) move.mutate({ id: String(active.id), toIndex });
  }

  const titleOf = (id: UniqueIdentifier) =>
    items.find((item) => item.id === id)?.title ?? 'the item';
  const placeOf = (id: UniqueIdentifier) =>
    `position ${String(items.findIndex((item) => item.id === id) + 1)} of ${String(items.length)}`;
  // dnd-kit reads these to screen readers as a drag goes on (spec §7, Plan 3b rule 12).
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up “${titleOf(active.id)}”, ${placeOf(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `“${titleOf(active.id)}” is over ${placeOf(over.id)}.`
        : `“${titleOf(active.id)}” is outside the list.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `Dropped “${titleOf(active.id)}” at ${placeOf(over.id)}.`
        : `Dropped “${titleOf(active.id)}” where it was.`,
    onDragCancel: ({ active }) =>
      `Cancelled. “${titleOf(active.id)}” is back at ${placeOf(active.id)}.`,
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            'To move an item, press Space. Use the up and down arrow keys to choose its new place, then press Space to drop it, or Escape to cancel.',
        },
      }}
    >
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <ol
          aria-label="Your items, most wanted first"
          className="mt-5 overflow-hidden rounded-card border border-border bg-card"
        >
          {items.map((item, index) => (
            <ItemRow
              key={item.id}
              item={item}
              index={index}
              count={items.length}
              open={open === item.id}
              onToggle={() => toggle(item.id)}
              onMove={(step) => moveBy(item, index, step)}
              titleButtonRef={(button) => {
                if (button) titleButtons.current.set(item.id, button);
                else titleButtons.current.delete(item.id);
              }}
              arrowRef={(which) => (button) => {
                const key = `${item.id}:${which}`;
                if (button) arrowButtons.current.set(key, button);
                else arrowButtons.current.delete(key);
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
      </SortableContext>
    </DndContext>
  );
}
