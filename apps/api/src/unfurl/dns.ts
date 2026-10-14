import { Resolver } from 'node:dns/promises';

/**
 * Resolves a hostname to every address it has. `signal` aborts at the fetch's deadline, and the
 * lookup should stop then, not just be abandoned (spec §6.8).
 */
export type Resolve = (hostname: string, signal: AbortSignal) => Promise<string[]>;

/** The part of `dns.promises.Resolver` a lookup uses. Tests pass a fake. */
export interface DnsResolver {
  resolve4(hostname: string): Promise<string[]>;
  resolve6(hostname: string): Promise<string[]>;
  cancel(): void;
}

export interface CaresResolveOptions {
  /** How many lookups may run at once in this process. */
  maxConcurrent?: number;
  /** Makes the resolver for one lookup. */
  newResolver?: () => DnsResolver;
}

// c-ares gives up by itself after about 6-7 s per unreachable nameserver (2 s, then a doubled
// retry), in case nothing cancels it. The fetch's deadline normally cancels it first.
const newCaresResolver = (): DnsResolver => new Resolver({ timeout: 2_000, tries: 2 });

/**
 * Hostname lookups for unfurl, with c-ares rather than `dns.lookup` (spec §6.8, Plan 4a).
 * `dns.lookup` is getaddrinfo on one of libuv's four threadpool threads, and it holds that thread
 * until the OS gives up, long after our deadline. A few slow lookups then starve everything else
 * on the pool, argon2 included. c-ares does its own non-blocking I/O.
 * - A and AAAA are asked for in parallel, and the answers joined. One family failing is fine.
 * - Each lookup has its own resolver, cancelled at the deadline: `cancel()` stops every query on a
 *   resolver, so a shared one would cancel other people's lookups too.
 * - At most `maxConcurrent` run at once. One still waiting for its turn at the deadline never
 *   starts.
 */
export function createCaresResolve(options: CaresResolveOptions = {}): Resolve {
  const maxConcurrent = options.maxConcurrent ?? 4;
  const newResolver = options.newResolver ?? newCaresResolver;
  let running = 0;
  const queue: (() => void)[] = [];

  const acquire = (signal: AbortSignal): Promise<void> => {
    if (signal.aborted) return Promise.reject(signal.reason as Error);
    if (running < maxConcurrent) {
      running++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const start = () => {
        signal.removeEventListener('abort', giveUp);
        running++;
        resolve();
      };
      const giveUp = () => {
        const index = queue.indexOf(start);
        if (index !== -1) queue.splice(index, 1);
        reject(signal.reason as Error);
      };
      queue.push(start);
      signal.addEventListener('abort', giveUp, { once: true });
    });
  };

  const release = () => {
    running--;
    queue.shift()?.();
  };

  return async (hostname, signal) => {
    await acquire(signal);
    try {
      // The deadline may have passed while this lookup waited for its turn to be handed over.
      // Checked before the resolver exists, so such a lookup never creates a c-ares channel.
      signal.throwIfAborted();
      return await lookUp(newResolver(), hostname, signal);
    } finally {
      release();
    }
  };
}

async function lookUp(
  resolver: DnsResolver,
  hostname: string,
  signal: AbortSignal,
): Promise<string[]> {
  const cancel = () => resolver.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const [v4, v6] = await Promise.allSettled([
      resolver.resolve4(hostname),
      resolver.resolve6(hostname),
    ]);
    if (v4.status === 'rejected' && v6.status === 'rejected') {
      throw new Error('no A or AAAA records', { cause: v4.reason });
    }
    return [
      ...(v4.status === 'fulfilled' ? v4.value : []),
      ...(v6.status === 'fulfilled' ? v6.value : []),
    ];
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
