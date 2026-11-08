import type { UnfurlResponse } from '@wishlist/contracts';
import { describe, expect, it } from 'vitest';
import { LinkReader, type ReadOutcome } from './link-reader';

/** A `post` whose every call can be settled by hand. */
function setup() {
  const calls: {
    url: string;
    signal: AbortSignal;
    resolve: (response: UnfurlResponse) => void;
    reject: (reason: unknown) => void;
  }[] = [];
  const post = (url: string, signal: AbortSignal) =>
    new Promise<UnfurlResponse>((resolve, reject) => {
      calls.push({ url, signal, resolve, reject });
    });
  const done: { url: string; outcome: ReadOutcome }[] = [];
  const reader = new LinkReader(post, (url, outcome) => done.push({ url, outcome }));
  return { reader, calls, done };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('LinkReader (D117)', () => {
  it('reads a link and hands over the answer', async () => {
    const { reader, calls, done } = setup();
    reader.read('https://shop.example/k');
    expect(calls.map((call) => call.url)).toEqual(['https://shop.example/k']);
    calls[0]?.resolve({ title: 'Kettle' });
    await settle();
    expect(done).toEqual([
      { url: 'https://shop.example/k', outcome: { response: { title: 'Kettle' } } },
    ]);
  });

  it('hands over a failure as an error', async () => {
    const { reader, calls, done } = setup();
    reader.read('https://shop.example/k');
    const offline = new TypeError('offline');
    calls[0]?.reject(offline);
    await settle();
    expect(done).toEqual([{ url: 'https://shop.example/k', outcome: { error: offline } }]);
  });

  it('aborts the older read when another link is pasted, and keeps only the newer answer', async () => {
    const { reader, calls, done } = setup();
    reader.read('https://shop.example/a');
    reader.read('https://shop.example/b');
    expect(calls[0]?.signal.aborted).toBe(true);
    expect(calls[1]?.signal.aborted).toBe(false);
    calls[1]?.resolve({ title: 'B' });
    calls[0]?.resolve({ title: 'A' });
    await settle();
    expect(done).toEqual([
      { url: 'https://shop.example/b', outcome: { response: { title: 'B' } } },
    ]);
  });

  it('says whether it was reading, and drops the answer, when cancelled', async () => {
    const { reader, calls, done } = setup();
    expect(reader.cancel()).toBe(false);
    reader.read('https://shop.example/k');
    expect(reader.cancel()).toBe(true);
    expect(calls[0]?.signal.aborted).toBe(true);
    calls[0]?.reject(new DOMException('aborted', 'AbortError'));
    await settle();
    expect(done).toEqual([]);
    expect(reader.cancel()).toBe(false);
  });

  it('is done reading once the answer is handed over', async () => {
    const { reader, calls } = setup();
    reader.read('https://shop.example/k');
    calls[0]?.resolve({});
    await settle();
    expect(reader.cancel()).toBe(false);
  });

  it('aborts on dispose, and reads nothing afterwards', async () => {
    const { reader, calls, done } = setup();
    reader.read('https://shop.example/k');
    reader.dispose();
    expect(calls[0]?.signal.aborted).toBe(true);
    calls[0]?.resolve({ title: 'Kettle' });
    reader.read('https://shop.example/other');
    await settle();
    expect(calls).toHaveLength(1);
    expect(done).toEqual([]);
  });
});
