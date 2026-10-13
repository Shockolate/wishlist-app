'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { WishlistResponseSchema, type WishlistResponse } from '@wishlist/contracts';
import { browserApi } from '@/lib/browser-api';
import { WISHLIST_KEY } from '@/lib/list-cache';
import { AddItem } from './add-item';
import { ItemList } from './item-list';
import { ListStatusLine, ListStatusProvider } from './list-status';
import { ShareActions } from './share-actions';

/** The owner's list (spec §7 Owner editor, D37). The server render seeds the cache. */
export function ListEditor({ initial }: { initial: WishlistResponse }) {
  return (
    <ListStatusProvider>
      <Editor initial={initial} />
    </ListStatusProvider>
  );
}

function Editor({ initial }: { initial: WishlistResponse }) {
  const client = useQueryClient();
  const { data: list } = useQuery({
    queryKey: WISHLIST_KEY,
    queryFn: () => browserApi.get('/wishlist', WishlistResponseSchema),
    initialData: initial,
    staleTime: Infinity,
    // Back on the tab, refetch, but only while nothing is waiting to be sent (Plan 3b rule 1).
    refetchOnWindowFocus: () => (client.isMutating() === 0 ? 'always' : false),
  });
  const hasItems = list.items.length > 0;

  return (
    <>
      <h1 className="font-display text-[clamp(2.5rem,6vw,4rem)] leading-none [overflow-wrap:anywhere]">
        {list.title}
      </h1>
      <p className="mt-2.5 text-[15px] leading-relaxed text-muted-foreground">
        {hasItems
          ? 'Gifters see your list in this order, so put what you’d love most at the top.'
          : 'Add the things you’d love. When you’re ready, send one link to family and friends.'}
      </p>
      {hasItems ? <ShareActions title={list.title} shareUrl={list.shareUrl} /> : null}
      <AddItem />
      <ListStatusLine />
      {hasItems ? <ItemList items={list.items} /> : <EmptyList />}
    </>
  );
}

function EmptyList() {
  return (
    <div className="mt-7 rounded-card border-[1.5px] border-dashed border-input px-5 py-7 text-center">
      <p className="font-display text-3xl leading-tight">Nothing here yet</p>
      <p className="mx-auto mt-2.5 max-w-[290px] text-[15px] text-muted-foreground">
        Copy a link from any shop and paste it above, or type an idea, like “a pottery class”.
      </p>
    </div>
  );
}
