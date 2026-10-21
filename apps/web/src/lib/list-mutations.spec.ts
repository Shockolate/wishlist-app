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
  type Tag,
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

const tag = (n: number, name = `Tag ${String(n)}`): Tag => ({
  id: `00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`,
  name,
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
  return setupWith(undefined, ...items);
}

function setupWith(tags: Tag[] | undefined, ...items: Item[]) {
  const client = new QueryClient();
  const list: WishlistResponse = {
    title: 'Ada’s wishlist',
    shareUrl: 'https://hanker.test/s/abcdefghijklmnopqrstuv',
    ...(tags ? { tags } : {}),
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
  const cached = () => client.getQueryData<WishlistResponse>(WISHLIST_KEY);
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
    cached,
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
    expect(t.sent[0]).toEqual({
      method: 'DELETE',
      path: `/api/wishlist/items/${item(1).id}`,
      // The CSRF guard refuses a state-changing request that isn't JSON, so a delete sends {}.
      body: {},
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

  it('cancels a refetch in flight when an add starts, and refetches once the add has settled', async () => {
    const t = setup(item(1));
    t.watch();
    void t.client.invalidateQueries({ queryKey: WISHLIST_KEY });
    await vi.waitFor(() => expect(t.sent).toHaveLength(1));
    expect(t.sent[0]?.method).toBe('GET');
    const adding = t.run(t.mutations.create, { title: 'Item 2', quantity: 1 });
    await vi.waitFor(() => expect(t.sent).toHaveLength(2));
    expect(t.sent[1]?.method).toBe('POST');
    // The GET that was cancelled would have answered from before the add. Its late answer is dropped.
    t.answer(0, json(200, t.serverList(item(1))));
    t.answer(1, json(201, item(2)));
    await adding;
    expect(t.order()).toEqual([item(1).id, item(2).id]);
    // Now the list is refetched, so the server's version is what stays.
    await vi.waitFor(() => expect(t.sent).toHaveLength(3));
    expect(t.sent[2]).toMatchObject({ method: 'GET', path: '/api/wishlist' });
    t.answer(2, json(200, t.serverList(item(1), item(2))));
    await vi.waitFor(() => expect(t.invalidated()).toBe(false));
    expect(t.order()).toEqual([item(1).id, item(2).id]);
  });

  it('cancels a refetch in flight when a save starts, and refetches once the save has settled', async () => {
    const t = setup(item(1, { priceText: '$40' }));
    t.watch();
    void t.client.invalidateQueries({ queryKey: WISHLIST_KEY });
    await vi.waitFor(() => expect(t.sent).toHaveLength(1));
    expect(t.sent[0]?.method).toBe('GET');
    const editing = t.run(t.mutations.update, { id: item(1).id, body: { priceText: '$48' } });
    await vi.waitFor(() => expect(t.sent).toHaveLength(2));
    expect(t.sent[1]?.method).toBe('PATCH');
    // The cancelled GET would have brought back the old price after the save.
    t.answer(0, json(200, t.serverList(item(1, { priceText: '$40' }))));
    t.answer(1, json(200, item(1, { priceText: '$48' })));
    await editing;
    const price = () => t.client.getQueryData<WishlistResponse>(WISHLIST_KEY)?.items[0]?.priceText;
    expect(price()).toBe('$48');
    await vi.waitFor(() => expect(t.sent).toHaveLength(3));
    expect(t.sent[2]).toMatchObject({ method: 'GET', path: '/api/wishlist' });
    t.answer(2, json(200, t.serverList(item(1, { priceText: '$48' }))));
    await vi.waitFor(() => expect(t.invalidated()).toBe(false));
    expect(price()).toBe('$48');
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

  describe('tags (Plan 7b rulings 4, 7)', () => {
    it('adds the tags an item write answers with, and stores the item without them', async () => {
      const t = setupWith([tag(1)], item(1));
      const adding = t.run(t.mutations.create, {
        title: 'Item 2',
        quantity: 1,
        tags: [{ name: 'Garden' }, { id: tag(1).id }],
      });
      await vi.waitFor(() => expect(t.sent).toHaveLength(1));
      t.answer(
        0,
        json(201, {
          ...item(2, { tagIds: [tag(2).id, tag(1).id] }),
          tags: [tag(2, 'Garden'), tag(1)],
        }),
      );
      await adding;
      expect(t.cached()?.tags).toEqual([tag(1), tag(2, 'Garden')]);
      const stored = t.cached()?.items[1];
      expect(stored?.tagIds).toEqual([tag(2).id, tag(1).id]);
      expect(stored).not.toHaveProperty('tags');
    });

    it('takes a renamed tag from a save, and stores the edited item without tags', async () => {
      const t = setupWith([tag(1, 'Old')], item(1, { tagIds: [tag(1).id] }));
      const editing = t.run(t.mutations.update, {
        id: item(1).id,
        body: { tags: [{ id: tag(1).id }] },
      });
      await vi.waitFor(() => expect(t.sent).toHaveLength(1));
      t.answer(0, json(200, { ...item(1, { tagIds: [tag(1).id] }), tags: [tag(1, 'Renamed')] }));
      await editing;
      expect(t.cached()?.tags).toEqual([tag(1, 'Renamed')]);
      expect(t.cached()?.items[0]).not.toHaveProperty('tags');
    });

    it('still saves against an API that sends no tags', async () => {
      const t = setup(item(1));
      const adding = t.run(t.mutations.create, { title: 'Item 2', quantity: 1 });
      await vi.waitFor(() => expect(t.sent).toHaveLength(1));
      t.answer(0, json(201, item(2)));
      await adding;
      expect(t.cached()?.tags).toBeUndefined();
      expect(t.order()).toEqual([item(1).id, item(2).id]);
    });

    it('shows a tick at once, and sends PUT /wishlist/tags/<tag>/items/<item>', async () => {
      const t = setupWith([tag(1)], item(1));
      const ticking = t.run(t.mutations.tick, { tagId: tag(1).id, itemId: item(1).id });
      await vi.waitFor(() => expect(t.cached()?.items[0]?.tagIds).toEqual([tag(1).id]));
      await vi.waitFor(() => expect(t.sent).toHaveLength(1));
      expect(t.sent[0]).toEqual({
        method: 'PUT',
        path: `/api/wishlist/tags/${tag(1).id}/items/${item(1).id}`,
        body: {},
      });
      t.answer(0, noContent());
      await ticking;
      expect(t.invalidated()).toBe(false);
    });

    it('shows an untick at once, and sends DELETE /wishlist/tags/<tag>/items/<item>', async () => {
      const t = setupWith([tag(1)], item(1, { tagIds: [tag(1).id] }));
      const unticking = t.run(t.mutations.untick, { tagId: tag(1).id, itemId: item(1).id });
      await vi.waitFor(() => expect(t.cached()?.items[0]?.tagIds).toEqual([]));
      await vi.waitFor(() => expect(t.sent).toHaveLength(1));
      expect(t.sent[0]).toEqual({
        method: 'DELETE',
        path: `/api/wishlist/tags/${tag(1).id}/items/${item(1).id}`,
        body: {},
      });
      t.answer(0, noContent());
      await unticking;
      expect(t.invalidated()).toBe(false);
    });

    it('refetches once the queue drains after a tick that fails', async () => {
      const t = setupWith([tag(1)], item(1));
      t.watch();
      const ticking = t.run(t.mutations.tick, { tagId: tag(1).id, itemId: item(1).id });
      await vi.waitFor(() => expect(t.sent).toHaveLength(1));
      t.answer(0, problem(422, ErrorCode.ITEM_TAG_LIMIT_REACHED));
      await expect(ticking).rejects.toThrow('422 ITEM_TAG_LIMIT_REACHED');
      await vi.waitFor(() => expect(t.sent).toHaveLength(2));
      expect(t.sent[1]).toMatchObject({ method: 'GET', path: '/api/wishlist' });
    });

    it('sends a tick queued behind a save second', async () => {
      const t = setupWith([tag(1)], item(1));
      const editing = t.run(t.mutations.update, { id: item(1).id, body: { title: 'Kettle' } });
      const ticking = t.run(t.mutations.tick, { tagId: tag(1).id, itemId: item(1).id });
      // The tick shows at once, but its request waits for the save's.
      await vi.waitFor(() => expect(t.cached()?.items[0]?.tagIds).toEqual([tag(1).id]));
      expect(t.sent.map((r) => r.method)).toEqual(['PATCH']);
      t.answer(0, json(200, item(1, { title: 'Kettle' })));
      await editing;
      await vi.waitFor(() => expect(t.sent).toHaveLength(2));
      expect(t.sent[1]?.method).toBe('PUT');
      t.answer(1, noContent());
      await ticking;
    });

    it('removes a deleted tag from the list and its items before the request runs', async () => {
      const t = setupWith([tag(1), tag(2)], item(1, { tagIds: [tag(1).id, tag(2).id] }), item(2));
      const deleting = t.run(t.mutations.deleteTag, tag(1).id);
      await vi.waitFor(() => expect(t.cached()?.tags).toEqual([tag(2)]));
      expect(t.cached()?.items[0]?.tagIds).toEqual([tag(2).id]);
      await vi.waitFor(() => expect(t.sent).toHaveLength(1));
      expect(t.sent[0]).toEqual({
        method: 'DELETE',
        path: `/api/wishlist/tags/${tag(1).id}`,
        body: {},
      });
      t.answer(0, noContent());
      await deleting;
      expect(t.invalidated()).toBe(false);
    });

    it('waits for the API before adding a created tag', async () => {
      const t = setupWith([], item(1));
      const creating = t.run(t.mutations.createTag, 'Garden');
      await vi.waitFor(() => expect(t.sent).toHaveLength(1));
      expect(t.sent[0]).toEqual({
        method: 'POST',
        path: '/api/wishlist/tags',
        body: { name: 'Garden' },
      });
      expect(t.cached()?.tags).toEqual([]);
      t.answer(0, json(201, tag(1, 'Garden')));
      await expect(creating).resolves.toEqual(tag(1, 'Garden'));
      expect(t.cached()?.tags).toEqual([tag(1, 'Garden')]);
    });

    it('accepts the 200 an existing tag name gets, without adding it twice', async () => {
      const t = setupWith([tag(1, 'Garden')], item(1));
      const creating = t.run(t.mutations.createTag, 'garden');
      await vi.waitFor(() => expect(t.sent).toHaveLength(1));
      t.answer(0, json(200, tag(1, 'Garden')));
      await creating;
      expect(t.cached()?.tags).toEqual([tag(1, 'Garden')]);
    });

    it('waits for the API before renaming, and leaves the name alone when it is taken', async () => {
      const t = setupWith([tag(1, 'Garden'), tag(2, 'Kitchen')], item(1));
      const renaming = t.run(t.mutations.renameTagTo, { id: tag(1).id, name: 'Yard' });
      await vi.waitFor(() => expect(t.sent).toHaveLength(1));
      expect(t.sent[0]).toEqual({
        method: 'PATCH',
        path: `/api/wishlist/tags/${tag(1).id}`,
        body: { name: 'Yard' },
      });
      expect(t.cached()?.tags?.[0]?.name).toBe('Garden');
      t.answer(0, json(200, tag(1, 'Yard')));
      await renaming;
      expect(t.cached()?.tags).toEqual([tag(1, 'Yard'), tag(2, 'Kitchen')]);

      const clash = t.run(t.mutations.renameTagTo, { id: tag(2).id, name: 'Yard' });
      await vi.waitFor(() => expect(t.sent).toHaveLength(2));
      t.answer(1, problem(409, ErrorCode.TAG_NAME_TAKEN));
      await expect(clash).rejects.toThrow('409 TAG_NAME_TAKEN');
      expect(t.cached()?.tags?.[1]?.name).toBe('Kitchen');
    });
  });
});
