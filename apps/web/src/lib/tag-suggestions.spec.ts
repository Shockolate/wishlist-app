import type {
  ItemTagRef,
  TagSuggestionsRequest,
  TagSuggestionsResponse,
} from '@wishlist/contracts';
import { describe, expect, it } from 'vitest';
import { SuggestionAsker } from './tag-suggestions';

const KITCHEN = '00000000-0000-4000-8000-000000000001';

/** A `post` whose every call can be settled by hand. */
function setup() {
  const calls: {
    body: TagSuggestionsRequest;
    signal: AbortSignal;
    resolve: (suggestions: ItemTagRef[]) => void;
    reject: (reason: unknown) => void;
  }[] = [];
  const post = (body: TagSuggestionsRequest, signal: AbortSignal) =>
    new Promise<TagSuggestionsResponse>((resolve, reject) => {
      calls.push({ body, signal, resolve: (suggestions) => resolve({ suggestions }), reject });
    });
  const changes: ItemTagRef[][] = [];
  const asker = new SuggestionAsker(post, (suggestions) => changes.push(suggestions));
  return { asker, calls, changes };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('SuggestionAsker (tag suggestions design §5.1, ruling 2)', () => {
  it('posts once for a title, and not at all for an empty one', () => {
    const { asker, calls } = setup();
    asker.ask({ title: '' });
    asker.ask({ title: '   ' });
    expect(calls).toHaveLength(0);
    asker.ask({ title: 'Kettle' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({ title: 'Kettle' });
  });

  it('does not post again for the title it last asked about', () => {
    const { asker, calls } = setup();
    asker.ask({ title: 'Kettle' });
    asker.ask({ title: 'Kettle', note: 'The blue one' });
    expect(calls).toHaveLength(1);
  });

  it('posts again for a changed title and aborts the older request', () => {
    const { asker, calls } = setup();
    asker.ask({ title: 'Kettle' });
    asker.ask({ title: 'Teapot' });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.signal.aborted).toBe(true);
    expect(calls[1]?.signal.aborted).toBe(false);
  });

  it('gives onChange the answer', async () => {
    const { asker, calls, changes } = setup();
    asker.ask({ title: 'Kettle' });
    calls[0]?.resolve([{ id: KITCHEN }]);
    await settle();
    expect(changes).toEqual([[{ id: KITCHEN }]]);
  });

  it('shows only the latest answer when the older one resolves last', async () => {
    const { asker, calls, changes } = setup();
    asker.ask({ title: 'Kettle' });
    asker.ask({ title: 'Teapot' });
    calls[1]?.resolve([{ name: 'Tea' }]);
    await settle();
    calls[0]?.resolve([{ id: KITCHEN }]);
    await settle();
    expect(changes).toEqual([[{ name: 'Tea' }]]);
  });

  it('ignores a rejection from a request that was replaced', async () => {
    const { asker, calls, changes } = setup();
    asker.ask({ title: 'Kettle' });
    asker.ask({ title: 'Teapot' });
    calls[0]?.reject(new DOMException('aborted', 'AbortError'));
    await settle();
    expect(changes).toEqual([]);
  });

  it('aborts on dispose and never calls onChange afterwards', async () => {
    const { asker, calls, changes } = setup();
    asker.ask({ title: 'Kettle' });
    asker.dispose();
    expect(calls[0]?.signal.aborted).toBe(true);
    calls[0]?.resolve([{ id: KITCHEN }]);
    await settle();
    expect(changes).toEqual([]);
  });

  it('does not post after dispose', () => {
    const { asker, calls } = setup();
    asker.dispose();
    asker.ask({ title: 'Kettle' });
    expect(calls).toHaveLength(0);
  });

  it('shows none when the request fails', async () => {
    const { asker, calls, changes } = setup();
    asker.ask({ title: 'Kettle' });
    calls[0]?.reject(new Error('429'));
    await settle();
    expect(changes).toEqual([[]]);
  });

  it('gives each title its own answer, in order', async () => {
    const { asker, calls, changes } = setup();
    asker.ask({ title: 'Kettle' });
    calls[0]?.resolve([{ id: KITCHEN }]);
    await settle();
    asker.ask({ title: 'Teapot' });
    calls[1]?.resolve([{ name: 'Tea' }]);
    await settle();
    expect(changes).toEqual([[{ id: KITCHEN }], [{ name: 'Tea' }]]);
  });
});
