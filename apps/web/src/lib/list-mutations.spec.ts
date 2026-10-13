import {
  MutationObserver,
  QueryClient,
  QueryObserver,
  type MutationOptions,
} from '@tanstack/react-query';
import {
  ErrorCode,
  WishlistResponseSchema,
  type Item,
  type WishlistResponse,
} from '@wishlist/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './api-client';
import { orderOf, WISHLIST_KEY } from './list-cache';
import { listMutations } from './list-mutations';

const item = (n: number, extra: Partial<Item> = {}): Item => ({
  id: `00000000-0000-4000-8000-00000000000${String(n)}`,
  title: `Item ${String(n)}`,
  url: null,
  imageUrl: null,
  priceText: null,
  note: null,
  quantity: 1,
  position: n,
  ...extra,
});

interface Sent {
  method: string;
  path: string;
  body: unknown;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const noContent = () => new Response(null, { status: 204 });
const problem = (status: number, code: string) =>
  new Response(JSON.stringify({ type: 'about:blank', title: 't', status, code, requestId: 'r' }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });

/** A list in a real QueryClient, and an API whose every request waits for `answer(n, …)`. */
function setup(...items: Item[]) {
  const client = new QueryClient();
  const list: WishlistResponse = {
    title: 'Ada’s wishlist',
    shareUrl: 'https://hanker.test/s/abcdefghijklmnopqrstuv',
    items,
  };
  client.setQueryData(WISHLIST_KEY, list);
  const sent: Sent[] = [];
  const answers: ((res: Response) => void)[] = [];
  const api = createApiClient({
    baseUrl: 'http://api.test',
    fetch: (url, init) => {
      sent.push({
        method: init.method ?? 'GET',
        path: new URL(url).pathname,
        body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
      });
      return new Promise<Response>((resolve) => answers.push(resolve));
    },
  });
  const answer = (n: number, res: Response) => {
    const respond = answers[n];
    if (!respond) throw new Error(`request ${String(n)} hasn't been sent`);
    respond(res);
  };
  const run = <D, V>(options: MutationOptions<D, unknown, V>, variables: V) =>
    new MutationObserver(client, options).mutate(variables);
  const order = () => orderOf(client.getQueryData<WishlistResponse>(WISHLIST_KEY));
  const invalidated = () => client.getQueryState(WISHLIST_KEY)?.isInvalidated ?? false;
  // The page's own subscription to the list, so that invalidating it really refetches (a GET in `sent`).
  const watch = () =>
    new QueryObserver(client, {
      queryKey: WISHLIST_KEY,
      queryFn: () => api.get('/wishlist', WishlistResponseSchema),
      staleTime: Infinity,
    }).subscribe(() => undefined);
  // Lets anything that was going to happen next happen, so a test can assert that it didn't.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const serverList = (...items: Item[]): WishlistResponse => ({
    title: 'Ada’s wishlist',
    shareUrl: 'https://hanker.test/s/abcdefghijklmnopqrstuv',
    items,
  });
  return {
    client,
    mutations: listMutations(client, api),
    sent,
    answer,
    run,
    order,
    invalidated,
    watch,
    settle,
    serverList,
  };
}

describe('the list’s mutation queue (spec §7, Plan 3b rules 2–4)', () => {
  it('shows a move at once, and sends the whole order', async () => {
    const t = setup(item(1), item(2));
    const moving = t.run(t.mutations.move, { id: item(2).id, toIndex: 0 });
    await vi.waitFor(() => expect(t.order()).toEqual([item(2).id, item(1).id]));
    await vi.waitFor(() => expect(t.sent).toHaveLength(1));
    expect(t.sent[0]).toEqual({
      method: 'PUT',
      path: '/api/wishlist/items/order',
      body: { itemIds: [item(2).id, item(1).id] },
    });
    t.answer(0, noContent());
    await moving;
    expect(t.invalidated()).toBe(false);
  });

  it('sends a move queued behind an add with the new item in it (Review Focus 2)', async () => {
    const t = setup(item(1), item(2));
    const adding = t.run(t.mutations.create, { title: 'Item 3', quantity: 1 });
    const moving = t.run(t.mutations.move, { id: item(2).id, toIndex: 0 });
    await vi.waitFor(() => expect(t.order()).toEqual([item(2).id, item(1).id]));
    // The move waits its turn: only the add has gone out.
    expect(t.sent.map((r) => r.method)).toEqual(['POST']);
    t.answer(0, json(201, item(3)));
    await adding;
    await vi.waitFor(() => expect(t.sent).toHaveLength(2));
    expect(t.sent[1]?.body).toEqual({ itemIds: [item(2).id, item(1).id, item(3).id] });
    t.answer(1, noContent());
    await moving;
  });

  it('sends every one of several quick moves with the whole list, and the last with the final order', async () => {
    const t = setup(item(1), item(2), item(3));
    const moves = [
      t.run(t.mutations.move, { id: item(1).id, toIndex: 1 }),
      t.run(t.mutations.move, { id: item(1).id, toIndex: 2 }),
      t.run(t.mutations.move, { id: item(3).id, toIndex: 0 }),
    ];
    const final = [item(3).id, item(2).id, item(1).id];
    await vi.waitFor(() => expect(t.order()).toEqual(final));
    for (let n = 0; n < moves.length; n++) {
      await vi.waitFor(() => expect(t.sent).toHaveLength(n + 1));
      // An earlier request may go out before a later move has applied, but never with an item
      // missing: the API answers 409 to anything but the exact set.
      const sentIds = (t.sent[n]?.body as { itemIds: string[] }).itemIds;
      expect([...sentIds].sort()).toEqual([...final].sort());
      t.answer(n, noContent());
    }
    await Promise.all(moves);
    expect(t.sent.at(-1)?.body).toEqual({ itemIds: final });
  });

  it('removes an item at once, and refetches the list when the API says it was gone', async () => {
    const t = setup(item(1), item(2));
    const removing = t.run(t.mutations.remove, item(1).id);
    await vi.waitFor(() => expect(t.order()).toEqual([item(2).id]));
    await vi.waitFor(() => expect(t.sent).toHaveLength(1));
    expect(t.sent[0]).toMatchObject({
      method: 'DELETE',
      path: `/api/wishlist/items/${item(1).id}`,
    });
    t.answer(0, problem(404, ErrorCode.NOT_FOUND));
    await expect(removing).rejects.toThrow('404 NOT_FOUND');
    expect(t.invalidated()).toBe(true);
  });

  it('refetches after a stale order only once what was queued behind it has run', async () => {
    const t = setup(item(1), item(2));
    const moving = t.run(t.mutations.move, { id: item(2).id, toIndex: 0 });
    const removing = t.run(t.mutations.remove, item(1).id);
    await vi.waitFor(() => expect(t.sent).toHaveLength(1));
    t.answer(0, problem(409, ErrorCode.ORDER_CONFLICT));
    await expect(moving).rejects.toThrow('409 ORDER_CONFLICT');
    // The list is stale, but the refetch waits: the delete behind it is still to run.
    expect(t.invalidated()).toBe(false);
    await vi.waitFor(() => expect(t.sent).toHaveLength(2));
    expect(t.sent[1]?.method).toBe('DELETE');
    t.answer(1, noContent());
    await removing;
    expect(t.invalidated()).toBe(true);
  });

  it('does not let a refetch bring back an item whose delete is still queued (no ghost)', async () => {
    const t = setup(item(1), item(2));
    t.watch();
    const moving = t.run(t.mutations.move, { id: item(2).id, toIndex: 0 });
    const removing = t.run(t.mutations.remove, item(1).id);
    await vi.waitFor(() => expect(t.sent).toHaveLength(1));
    t.answer(0, problem(409, ErrorCode.ORDER_CONFLICT));
    await expect(moving).rejects.toThrow('409 ORDER_CONFLICT');
    await vi.waitFor(() => expect(t.sent).toHaveLength(2));
    await t.settle();
    // Only the DELETE is out: no GET while it is pending.
    expect(t.sent.map((r) => r.method)).toEqual(['PUT', 'DELETE']);
    expect(t.order()).toEqual([item(2).id]);
    t.answer(1, noContent());
    await removing;
    await vi.waitFor(() => expect(t.sent).toHaveLength(3));
    expect(t.sent[2]).toMatchObject({ method: 'GET', path: '/api/wishlist' });
    t.answer(2, json(200, t.serverList(item(2, { title: 'Server copy' }))));
    await vi.waitFor(() =>
      expect(t.client.getQueryData<WishlistResponse>(WISHLIST_KEY)?.items).toEqual([
        item(2, { title: 'Server copy' }),
      ]),
    );
    await t.settle();
    expect(t.sent).toHaveLength(3);
  });

  it('refetches straight away after a failure with nothing queued behind it', async () => {
    const t = setup(item(1), item(2));
    t.watch();
    const removing = t.run(t.mutations.remove, item(1).id);
    await vi.waitFor(() => expect(t.sent).toHaveLength(1));
    t.answer(0, problem(404, ErrorCode.NOT_FOUND));
    await expect(removing).rejects.toThrow('404 NOT_FOUND');
    await vi.waitFor(() => expect(t.sent).toHaveLength(2));
    expect(t.sent[1]).toMatchObject({ method: 'GET', path: '/api/wishlist' });
    t.answer(1, json(200, t.serverList(item(2))));
    await vi.waitFor(() => expect(t.order()).toEqual([item(2).id]));
    await t.settle();
    expect(t.sent).toHaveLength(2);
  });

  it('refetches again once a change that cancelled a refetch in flight has settled', async () => {
    const t = setup(item(1), item(2));
    t.watch();
    void t.client.invalidateQueries({ queryKey: WISHLIST_KEY });
    await vi.waitFor(() => expect(t.sent).toHaveLength(1));
    expect(t.sent[0]?.method).toBe('GET');
    const moving = t.run(t.mutations.move, { id: item(2).id, toIndex: 0 });
    await vi.waitFor(() => expect(t.sent).toHaveLength(2));
    expect(t.sent[1]?.method).toBe('PUT');
    expect(t.order()).toEqual([item(2).id, item(1).id]);
    t.answer(1, noContent());
    await moving;
    // The GET the move cancelled runs again, now that the queue is empty.
    await vi.waitFor(() => expect(t.sent).toHaveLength(3));
    expect(t.sent[2]).toMatchObject({ method: 'GET', path: '/api/wishlist' });
    t.answer(2, json(200, t.serverList(item(2), item(1))));
    await vi.waitFor(() => expect(t.order()).toEqual([item(2).id, item(1).id]));
  });

  it.each([
    ['an add that finds the list full', 422, ErrorCode.LIST_FULL],
    ['an add that the server fails', 500, ErrorCode.INTERNAL_ERROR],
  ])('refetches the list after %s', async (_name, status, code) => {
    const t = setup(item(1));
    t.watch();
    const adding = t.run(t.mutations.create, { title: 'Item 2', quantity: 1 });
    await vi.waitFor(() => expect(t.sent).toHaveLength(1));
    t.answer(0, problem(status, code));
    await expect(adding).rejects.toThrow(code);
    await vi.waitFor(() => expect(t.sent).toHaveLength(2));
    expect(t.sent[1]).toMatchObject({ method: 'GET', path: '/api/wishlist' });
  });

  it('refetches the list after an edit of an item that was already gone', async () => {
    const t = setup(item(1));
    t.watch();
    const editing = t.run(t.mutations.update, { id: item(1).id, body: { title: 'Kettle' } });
    await vi.waitFor(() => expect(t.sent).toHaveLength(1));
    t.answer(0, problem(404, ErrorCode.NOT_FOUND));
    await expect(editing).rejects.toThrow('404 NOT_FOUND');
    await vi.waitFor(() => expect(t.sent).toHaveLength(2));
    expect(t.sent[1]).toMatchObject({ method: 'GET', path: '/api/wishlist' });
  });

  it.each([
    ['a validation error, which the form shows', 400, ErrorCode.VALIDATION_FAILED],
    ['a lost session, which leaves the page', 401, ErrorCode.UNAUTHENTICATED],
  ])('does not refetch the list after %s', async (_name, status, code) => {
    const t = setup(item(1));
    t.watch();
    const adding = t.run(t.mutations.create, { title: 'x', quantity: 1 });
    await vi.waitFor(() => expect(t.sent).toHaveLength(1));
    t.answer(0, problem(status, code));
    await expect(adding).rejects.toThrow(code);
    await t.settle();
    expect(t.sent).toHaveLength(1);
  });

  it('adds the item the API returns, and replaces an edited one with the API’s copy', async () => {
    const t = setup(item(1));
    const adding = t.run(t.mutations.create, { title: 'Item 2', quantity: 2 });
    await vi.waitFor(() => expect(t.sent).toHaveLength(1));
    expect(t.sent[0]).toEqual({
      method: 'POST',
      path: '/api/wishlist/items',
      body: { title: 'Item 2', quantity: 2 },
    });
    t.answer(0, json(201, item(2, { quantity: 2 })));
    await adding;
    expect(t.order()).toEqual([item(1).id, item(2).id]);

    const editing = t.run(t.mutations.update, { id: item(1).id, body: { title: 'Kettle' } });
    await vi.waitFor(() => expect(t.sent).toHaveLength(2));
    expect(t.sent[1]).toMatchObject({ method: 'PATCH', path: `/api/wishlist/items/${item(1).id}` });
    t.answer(1, json(200, item(1, { title: 'Kettle' })));
    await editing;
    const titles = t.client.getQueryData<WishlistResponse>(WISHLIST_KEY)?.items.map((i) => i.title);
    expect(titles).toEqual(['Kettle', 'Item 2']);
  });

  it('leaves the list alone after a validation error, which the form shows', async () => {
    const t = setup(item(1));
    const adding = t.run(t.mutations.create, { title: 'x', quantity: 1 });
    await vi.waitFor(() => expect(t.sent).toHaveLength(1));
    t.answer(0, problem(400, ErrorCode.VALIDATION_FAILED));
    await expect(adding).rejects.toThrow('400 VALIDATION_FAILED');
    expect(t.invalidated()).toBe(false);
  });
});
