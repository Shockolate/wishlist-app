'use client';

import {
  useMutation,
  useQueryClient,
  type MutationOptions,
  type QueryClient,
} from '@tanstack/react-query';
import { browserApi } from '@/lib/browser-api';
import { listMutations } from '@/lib/list-mutations';

type ListMutations = ReturnType<typeof listMutations>;

/**
 * One instance per QueryClient, not per component: the instance holds the "list is stale" flag that
 * a failure sets and the last settling change clears. If each component had its own, a failure in
 * one would wait for a queue drain that another's change never reports. Weakly keyed, so a
 * discarded client (a test's, or a page's) takes its instance with it.
 */
const instances = new WeakMap<QueryClient, ListMutations>();

export function listMutationsFor(client: QueryClient): ListMutations {
  let mutations = instances.get(client);
  if (!mutations) {
    mutations = listMutations(client, browserApi);
    instances.set(client, mutations);
  }
  return mutations;
}

/** The editor's mutation options, bound to this page's QueryClient and the browser API. */
export function useListMutations(): ListMutations {
  return listMutationsFor(useQueryClient());
}

/**
 * A list mutation whose every failure also reaches `onFailure`. Per-call mutate() callbacks fire
 * only for an observer's latest call, so quick repeated moves or deletes would lose one.
 */
export function useListMutation<D, V>(
  options: MutationOptions<D, unknown, V>,
  onFailure: (error: unknown) => void,
) {
  return useMutation<D, unknown, V>({
    ...options,
    onError: (error, ...rest) => {
      // Not awaited: the original onError is synchronous (it only marks the list stale).
      void options.onError?.(error, ...rest);
      onFailure(error);
    },
  });
}
