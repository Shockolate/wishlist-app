import { Resolver } from 'node:dns/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCaresResolve, type DnsResolver } from './dns.js';

/** A stand-in for c-ares: answers when told, and fails its queries when cancelled, as c-ares does. */
class FakeResolver implements DnsResolver {
  cancelled = false;
  private readonly pending: ((error: Error) => void)[] = [];
  constructor(private readonly answer: (family: 4 | 6) => Promise<string[]>) {}
  resolve4(): Promise<string[]> {
    return this.query(4);
  }
  resolve6(): Promise<string[]> {
    return this.query(6);
  }
  cancel(): void {
    this.cancelled = true;
    for (const fail of this.pending.splice(0)) {
      fail(Object.assign(new Error('cancelled'), { code: 'ECANCELLED' }));
    }
  }
  private query(family: 4 | 6): Promise<string[]> {
    return new Promise((resolve, reject) => {
      this.pending.push(reject);
      this.answer(family).then(resolve, reject);
    });
  }
}

const noRecords = () => Promise.reject(Object.assign(new Error('none'), { code: 'ENODATA' }));
const never = () => new Promise<string[]>(() => undefined);
const live = () => new AbortController().signal;
const flush = () => new Promise((resolve) => setImmediate(resolve));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createCaresResolve (spec §6.8, Plan 4a)', () => {
  it('joins the A and AAAA answers', async () => {
    const resolve = createCaresResolve({
      newResolver: () =>
        new FakeResolver((family) =>
          Promise.resolve(family === 4 ? ['93.184.216.34'] : ['2606:2800:220:1::1']),
        ),
    });
    await expect(resolve('shop.example', live())).resolves.toEqual([
      '93.184.216.34',
      '2606:2800:220:1::1',
    ]);
  });

  it('uses one family’s answer when the other has none', async () => {
    const resolve = createCaresResolve({
      newResolver: () =>
        new FakeResolver((family) =>
          family === 4 ? Promise.resolve(['93.184.216.34']) : noRecords(),
        ),
    });
    await expect(resolve('shop.example', live())).resolves.toEqual(['93.184.216.34']);
  });

  it('fails when neither family answers', async () => {
    const resolve = createCaresResolve({ newResolver: () => new FakeResolver(noRecords) });
    await expect(resolve('nowhere.example', live())).rejects.toThrow();
  });

  it('runs at most four lookups at once, and starts the next as one finishes', async () => {
    const release: (() => void)[] = [];
    let created = 0;
    const resolve = createCaresResolve({
      maxConcurrent: 4,
      newResolver: () => {
        created++;
        return new FakeResolver((family) =>
          family === 4
            ? new Promise((answer) => release.push(() => answer(['93.184.216.34'])))
            : noRecords(),
        );
      },
    });
    const lookups = Array.from({ length: 5 }, () => resolve('shop.example', live()));
    await flush();
    expect(created).toBe(4);
    release[0]?.();
    await lookups[0];
    await flush();
    expect(created).toBe(5);
    for (const answer of release.slice(1)) answer();
    await Promise.all(lookups);
  });

  it('never starts a lookup still waiting for its turn at the deadline', async () => {
    let created = 0;
    const resolve = createCaresResolve({
      maxConcurrent: 1,
      newResolver: () => {
        created++;
        return new FakeResolver(never);
      },
    });
    const first = new AbortController();
    const running = resolve('slow.example', first.signal);
    const second = new AbortController();
    const waiting = resolve('next.example', second.signal);
    second.abort(new Error('deadline'));
    await expect(waiting).rejects.toThrow('deadline');
    first.abort(new Error('deadline'));
    await expect(running).rejects.toThrow();
    expect(created).toBe(1);
  });

  it('cancels its own resolver at the deadline, and no one else’s', async () => {
    const resolvers: FakeResolver[] = [];
    const resolve = createCaresResolve({
      newResolver: () => {
        const resolver = new FakeResolver(never);
        resolvers.push(resolver);
        return resolver;
      },
    });
    const mine = new AbortController();
    const theirs = new AbortController();
    const myLookup = resolve('slow.example', mine.signal);
    const theirLookup = resolve('other.example', theirs.signal);
    await flush();
    mine.abort(new Error('deadline'));
    await expect(myLookup).rejects.toThrow();
    expect(resolvers.map((resolver) => resolver.cancelled)).toEqual([true, false]);
    theirs.abort(new Error('deadline'));
    await expect(theirLookup).rejects.toThrow();
  });

  it('frees its turn when a lookup is cancelled, so the next can start', async () => {
    let created = 0;
    const resolve = createCaresResolve({
      maxConcurrent: 1,
      newResolver: () => {
        created++;
        return new FakeResolver(
          created === 1
            ? never
            : (family) => (family === 4 ? Promise.resolve(['93.184.216.34']) : noRecords()),
        );
      },
    });
    const first = new AbortController();
    const stuck = resolve('slow.example', first.signal);
    const next = resolve('shop.example', live());
    first.abort(new Error('deadline'));
    await expect(stuck).rejects.toThrow();
    await expect(next).resolves.toEqual(['93.184.216.34']);
  });

  it('asks c-ares by default, not getaddrinfo', async () => {
    const v4 = vi
      .spyOn(Resolver.prototype, 'resolve4')
      .mockImplementation(() => Promise.resolve(['93.184.216.34']));
    vi.spyOn(Resolver.prototype, 'resolve6').mockImplementation(() => noRecords());
    await expect(createCaresResolve()('shop.example', live())).resolves.toEqual(['93.184.216.34']);
    expect(v4).toHaveBeenCalledWith('shop.example');
  });
});
