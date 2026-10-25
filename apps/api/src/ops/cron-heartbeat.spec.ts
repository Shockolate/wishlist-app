import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeErrorReporter } from '../testing/fakes.js';
import { BetterStackCronHeartbeat, NO_HEARTBEAT } from './cron-heartbeat.js';

const URL = 'https://uptime.betterstack.com/api/v1/heartbeat/SECRETTOKEN';

function fakeFetch(respond: (signal?: AbortSignal | null) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve().then(() => respond(init.signal));
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('BetterStackCronHeartbeat (D86)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pings the URL on success', async () => {
    const reporter = new FakeErrorReporter();
    const fetch = fakeFetch(() => new Response('', { status: 200 }));
    await new BetterStackCronHeartbeat(URL, reporter, fetch.fn).succeeded();
    expect(fetch.calls.map((c) => [c.url, c.init.method])).toEqual([[URL, 'GET']]);
    expect(reporter.warnings).toEqual([]);
  });

  it('pings URL/fail on failure', async () => {
    const fetch = fakeFetch(() => new Response('', { status: 200 }));
    await new BetterStackCronHeartbeat(URL, new FakeErrorReporter(), fetch.fn).failed();
    expect(fetch.calls.map((c) => c.url)).toEqual([`${URL}/fail`]);
  });

  it('warns without the URL on a non-2xx', async () => {
    const reporter = new FakeErrorReporter();
    const fetch = fakeFetch(() => new Response('nope', { status: 500 }));
    await new BetterStackCronHeartbeat(URL, reporter, fetch.fn).succeeded();
    expect(reporter.warnings).toEqual([{ message: 'cron heartbeat failed status=500' }]);
    expect(JSON.stringify(reporter.warnings)).not.toContain('SECRETTOKEN');
  });

  it('does not leak the URL when fetch rejects with it in the message', async () => {
    const reporter = new FakeErrorReporter();
    const fetch = fakeFetch(() => {
      throw new TypeError(`fetch failed ${URL}`, { cause: new Error(`connect to ${URL}`) });
    });
    await expect(
      new BetterStackCronHeartbeat(URL, reporter, fetch.fn).succeeded(),
    ).resolves.toBeUndefined();
    expect(reporter.warnings).toEqual([{ message: 'cron heartbeat failed status=none' }]);
    expect(JSON.stringify(reporter.warnings)).not.toContain('SECRETTOKEN');
    expect(reporter.exceptions).toEqual([]);
  });

  it('gives up after 5 seconds and warns status=none', async () => {
    vi.useFakeTimers();
    const reporter = new FakeErrorReporter();
    // As fetch does: reject when the signal aborts, and otherwise never settle.
    const fetch = fakeFetch(
      (signal) =>
        new Promise<Response>((_, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason as Error));
        }),
    );
    const ping = new BetterStackCronHeartbeat(URL, reporter, fetch.fn).succeeded();
    await vi.advanceTimersByTimeAsync(4999);
    expect(reporter.warnings).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await expect(ping).resolves.toBeUndefined();
    expect(reporter.warnings).toEqual([{ message: 'cron heartbeat failed status=none' }]);
  });
});

describe('NO_HEARTBEAT', () => {
  it('resolves without doing anything', async () => {
    await expect(NO_HEARTBEAT.succeeded()).resolves.toBeUndefined();
    await expect(NO_HEARTBEAT.failed()).resolves.toBeUndefined();
  });
});
