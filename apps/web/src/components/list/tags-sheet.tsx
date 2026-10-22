'use client';

import type { Item, Tag } from '@wishlist/contracts';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { Sheet, SheetClose, SheetContent } from '@/components/ui/sheet';
import { CloseIcon, TagIcon } from './icons';
import { useListStatus } from './list-status';
import { AllTagsPane } from './tags-sheet-list';
import { TagPane } from './tags-sheet-tag';

type View = { kind: 'all' } | { kind: 'tag'; id: string };

/**
 * The owner's Tags sheet (Plan 7b ruling 1, design §4, Ted's mockups 2a–2c), opened by the Tags
 * button beside the share actions. It reads the editor's cache through the props it's given, and
 * every change is a list mutation, so it joins the editor's one queue. A tick saves at once, so
 * Back leaving /list loses nothing. The panes are state inside the sheet's content, which unmounts
 * on close, so it always opens on all tags.
 */
export function TagsSheet({ items, tags }: { items: readonly Item[]; tags: readonly Tag[] }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button ref={button} variant="secondary" size="compact" onClick={() => setOpen(true)}>
        <TagIcon />
        Tags
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          // Each pane focuses its own title (see Panes).
          onOpenAutoFocus={(event) => event.preventDefault()}
          // A tap on a button doesn't focus it in every browser, so say where focus goes back to.
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            button.current?.focus();
          }}
          onEscapeKeyDown={(event) => {
            // In a name field, Escape cancels the field (it handles the key), not the sheet.
            if (event.target instanceof Element && event.target.closest('[data-inline-edit]')) {
              event.preventDefault();
            }
          }}
        >
          <Panes items={items} tags={tags} />
        </SheetContent>
      </Sheet>
    </>
  );
}

function Panes({ items, tags }: { items: readonly Item[]; tags: readonly Tag[] }) {
  const [view, setView] = useState<View>({ kind: 'all' });
  const title = useRef<HTMLHeadingElement>(null);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  // The tag whose pane Back just left, so its row takes focus on all tags.
  const backFrom = useRef<string | null>(null);
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const id of item.tagIds ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  // A tag deleted meanwhile (a refetch, another device) leaves its pane for all tags. A tag just
  // made may not be in `tags` yet: TanStack hands the cache change to React a timer after
  // createTag resolves, so all tags stays shown until it is.
  const tag = view.kind === 'tag' ? tags.find((each) => each.id === view.id) : undefined;
  const pane = tag ? `tag:${tag.id}` : 'all';

  // Focus moves when the pane shown changes, not when `view` does, so it moves once, to the pane
  // that's there: its title, or back on all tags, the row of the tag just left.
  useEffect(() => {
    const from = backFrom.current === null ? undefined : rows.current.get(backFrom.current);
    backFrom.current = null;
    (from ?? title.current)?.focus();
  }, [pane]);

  const close = (
    <SheetClose asChild>
      <button
        type="button"
        aria-label="Close"
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-control"
      >
        <CloseIcon />
      </button>
    </SheetClose>
  );

  return (
    <>
      {tag ? (
        <TagPane
          key={tag.id}
          tag={tag}
          items={items}
          count={counts.get(tag.id) ?? 0}
          title={title}
          close={close}
          onBack={() => {
            backFrom.current = tag.id;
            setView({ kind: 'all' });
          }}
          onDeleted={() => setView({ kind: 'all' })}
        />
      ) : (
        <AllTagsPane
          tags={tags}
          counts={counts}
          title={title}
          rows={rows}
          close={close}
          onOpen={(id) => setView({ kind: 'tag', id })}
        />
      )}
      <SheetStatus />
    </>
  );
}

/**
 * The editor's status line, inside the sheet: a modal sheet hides the rest of the page from screen
 * readers, the editor's own line included. Only what happened since the sheet opened; the line
 * under the editor already said the rest. It sits at the sheet's foot, so a new message never
 * moves the checkboxes under a finger.
 */
function SheetStatus() {
  const { message } = useListStatus();
  const [since] = useState(() => message?.id ?? 0);
  const shown = message && message.id > since ? message : null;
  return (
    <div className="sticky bottom-0 bg-background">
      <div role="status">
        {shown && shown.tone !== 'error' ? (
          <Notice key={shown.id} tone={shown.tone} announce={false} className="mt-4">
            {shown.text}
          </Notice>
        ) : null}
      </div>
      {shown?.tone === 'error' ? (
        <Notice key={shown.id} tone="error" className="mt-4">
          {shown.text}
        </Notice>
      ) : null}
    </div>
  );
}
