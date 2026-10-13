import type { MutationOptions, QueryClient } from '@tanstack/react-query';
import {
  ErrorCode,
  ItemSchema,
  type CreateItemRequest,
  type Item,
  type UpdateItemRequest,
  type WishlistResponse,
} from '@wishlist/contracts';
import { NoContentSchema, type ApiClient } from './api-client';
import { appendItem, moveItem, orderOf, removeItem, replaceItem, WISHLIST_KEY } from './list-cache';
import { hasCode } from './messages';

/** Every list change shares this scope, so changes reach the API one at a time, in order (spec §7). */
export const LIST_SCOPE = { id: 'wishlist' } as const;

export interface Move {
  id: string;
  toIndex: number;
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
 * The editor's four changes, as TanStack mutation options (Plan 3b rules 2–4). They're plain objects
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
  // Shared by the four changes: set by a failure or a cancelled refetch, cleared by the refetch.
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
    mutationFn: (body) => api.post('/wishlist/items', body, ItemSchema),
    onSuccess: (item) => change((list) => appendItem(list, item)),
    onError,
    onSettled,
  };
  const update: MutationOptions<Item, unknown, ItemEdit> = {
    scope: LIST_SCOPE,
    mutationFn: ({ id, body }) => api.patch(`/wishlist/items/${id}`, body, ItemSchema),
    onSuccess: (item) => change((list) => replaceItem(list, item)),
    onError,
    onSettled,
  };
  const remove: MutationOptions<undefined, unknown, string> = {
    scope: LIST_SCOPE,
    // An empty JSON body: the API's CSRF guard refuses a state-changing request without a JSON
    // content type, and the client sets one only when there is a body.
    mutationFn: (id) => api.delete(`/wishlist/items/${id}`, NoContentSchema, {}),
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
  return { create, update, remove, move };
}
