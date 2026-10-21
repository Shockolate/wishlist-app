import type { MutationOptions, QueryClient } from '@tanstack/react-query';
import {
  ErrorCode,
  ItemWriteResponseSchema,
  TagSchema,
  type CreateItemRequest,
  type Item,
  type Tag,
  type UpdateItemRequest,
  type WishlistResponse,
} from '@wishlist/contracts';
import { NoContentSchema, type ApiClient } from './api-client';
import {
  appendItem,
  mergeTags,
  moveItem,
  orderOf,
  removeItem,
  removeTag,
  renameTag,
  replaceItem,
  setItemTag,
  WISHLIST_KEY,
} from './list-cache';
import { hasCode } from './messages';

/** Every list change shares this scope, so changes reach the API one at a time, in order (spec §7). */
export const LIST_SCOPE = { id: 'wishlist' } as const;

export interface Move {
  id: string;
  toIndex: number;
}

export interface TagTick {
  tagId: string;
  itemId: string;
}

export interface TagRename {
  id: string;
  name: string;
}

export interface ItemEdit {
  id: string;
  body: UpdateItemRequest;
}

/**
 * Whether a failed change leaves the list stale, to be refetched once the queue drains. The refetch
 * is the rollback: restoring a snapshot would also undo the changes queued after it (spec §7). Not
 * after a form's own validation errors, and not after a lost session, which leaves the page
 * (Plan 3b rule 4).
 */
export function refetchesAfter(error: unknown): boolean {
  return !hasCode(error, ErrorCode.VALIDATION_FAILED) && !hasCode(error, ErrorCode.UNAUTHENTICATED);
}

/**
 * The editor's changes, as TanStack mutation options (Plan 3b rules 2–4). They're plain objects
 * so a unit test can run them against a real QueryClient, without React. TanStack runs a scoped
 * mutation's onMutate at once and its mutationFn when the scope is free, so a move or a delete shows
 * immediately and its request waits its turn.
 *
 * A failure marks the list stale rather than refetching it. A refetch isn't in the mutation scope,
 * so one that landed while changes were still queued would overwrite their optimistic state, and
 * nothing would re-apply it (a deleted item would come back). The refetch runs when the last
 * pending change settles.
 */
export function listMutations(client: QueryClient, api: ApiClient) {
  // Shared by every change: set by a failure or a cancelled refetch, cleared by the refetch.
  let stale = false;
  const change = (edit: (list: WishlistResponse) => WishlistResponse) => {
    client.setQueryData<WishlistResponse>(WISHLIST_KEY, (list) => (list ? edit(list) : list));
  };
  // An optimistic change mustn't be overwritten by a refetch that started before it. If it cancels
  // one in flight, the list is stale: it's refetched again when the queue drains.
  const holdRefetches = () => {
    if (client.isFetching({ queryKey: WISHLIST_KEY }) > 0) stale = true;
    return client.cancelQueries({ queryKey: WISHLIST_KEY });
  };
  // An item write's answer carries the tags it names, which the list may not hold yet (a tag made
  // by the write). The item itself is stored without them: it's an `Item`, and `tagIds` name them.
  const putItem = (
    answer: Item & { tags?: Tag[] },
    place: (list: WishlistResponse, item: Item) => WishlistResponse,
  ) => {
    const { tags, ...item } = answer;
    change((list) => place(mergeTags(list, tags ?? []), item));
  };
  const onError = (error: unknown) => {
    if (refetchesAfter(error)) stale = true;
  };
  // A settling mutation still counts itself in isMutating, as do the ones queued behind it.
  const onSettled = () => {
    if (!stale || client.isMutating() > 1) return;
    stale = false;
    void client.invalidateQueries({ queryKey: WISHLIST_KEY });
  };

  const create: MutationOptions<Item, unknown, CreateItemRequest> = {
    scope: LIST_SCOPE,
    mutationFn: (body) => api.post('/wishlist/items', body, ItemWriteResponseSchema),
    // A refetch already in flight would answer from before this add, and land after it.
    onMutate: holdRefetches,
    onSuccess: (answer) => putItem(answer, appendItem),
    onError,
    onSettled,
  };
  const update: MutationOptions<Item, unknown, ItemEdit> = {
    scope: LIST_SCOPE,
    mutationFn: ({ id, body }) => api.patch(`/wishlist/items/${id}`, body, ItemWriteResponseSchema),
    // As for create: a refetch from before the save mustn't land after it and revert the edit.
    onMutate: holdRefetches,
    onSuccess: (answer) => putItem(answer, replaceItem),
    onError,
    onSettled,
  };
  const remove: MutationOptions<undefined, unknown, string> = {
    scope: LIST_SCOPE,
    mutationFn: (id) => api.delete(`/wishlist/items/${id}`, NoContentSchema),
    onMutate: async (id) => {
      await holdRefetches();
      change((list) => removeItem(list, id));
    },
    onError,
    onSettled,
  };
  const move: MutationOptions<undefined, unknown, Move> = {
    scope: LIST_SCOPE,
    // The order the cache holds when this request runs, not when the move was made: a move
    // queued behind an add then includes the new item (spec §7, Plan 3b rule 3).
    mutationFn: () =>
      api.put(
        '/wishlist/items/order',
        { itemIds: orderOf(client.getQueryData<WishlistResponse>(WISHLIST_KEY)) },
        NoContentSchema,
      ),
    onMutate: async ({ id, toIndex }) => {
      await holdRefetches();
      change((list) => moveItem(list, id, toIndex));
    },
    onError,
    onSettled,
  };
  // Tags. A tick, an untick and a delete show at once, like a move; a new tag or a rename waits for
  // the API, like an add or a save, since the API decides the name that sticks (design §3).
  const createTag: MutationOptions<Tag, unknown, string> = {
    scope: LIST_SCOPE,
    mutationFn: (name) => api.post('/wishlist/tags', { name }, TagSchema),
    // As for create: a refetch from before the new tag mustn't land after it and drop it.
    onMutate: holdRefetches,
    onSuccess: (tag) => change((list) => mergeTags(list, [tag])),
    onError,
    onSettled,
  };
  const renameTagTo: MutationOptions<Tag, unknown, TagRename> = {
    scope: LIST_SCOPE,
    mutationFn: ({ id, name }) => api.patch(`/wishlist/tags/${id}`, { name }, TagSchema),
    onMutate: holdRefetches,
    onSuccess: (tag) => change((list) => renameTag(list, tag)),
    onError,
    onSettled,
  };
  const deleteTag: MutationOptions<undefined, unknown, string> = {
    scope: LIST_SCOPE,
    mutationFn: (id) => api.delete(`/wishlist/tags/${id}`, NoContentSchema),
    onMutate: async (id) => {
      await holdRefetches();
      change((list) => removeTag(list, id));
    },
    onError,
    onSettled,
  };
  const tick: MutationOptions<undefined, unknown, TagTick> = {
    scope: LIST_SCOPE,
    mutationFn: ({ tagId, itemId }) =>
      api.put(`/wishlist/tags/${tagId}/items/${itemId}`, undefined, NoContentSchema),
    onMutate: async ({ tagId, itemId }) => {
      await holdRefetches();
      change((list) => setItemTag(list, itemId, tagId, true));
    },
    onError,
    onSettled,
  };
  const untick: MutationOptions<undefined, unknown, TagTick> = {
    scope: LIST_SCOPE,
    mutationFn: ({ tagId, itemId }) =>
      api.delete(`/wishlist/tags/${tagId}/items/${itemId}`, NoContentSchema),
    onMutate: async ({ tagId, itemId }) => {
      await holdRefetches();
      change((list) => setItemTag(list, itemId, tagId, false));
    },
    onError,
    onSettled,
  };
  return { create, update, remove, move, createTag, renameTagTo, deleteTag, tick, untick };
}
