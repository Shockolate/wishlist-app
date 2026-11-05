import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { FakeClock, FakeErrorReporter } from '../testing/fakes.js';
import {
  FRANKFURTER_RATES_URL,
  FrankfurterExchangeRates,
  RATES_FRESH_MS,
  RATES_STALE_MS,
  RATES_TIMEOUT_MS,
} from './exchange-rates.js';
import { USER_AGENT } from './page-fetcher.js';

const START = new Date('2026-11-05T12:00:00.000Z');
const HOUR = 3_600_000;
const MINUTE = 60_000;
const TABLE = [{ date: '2026-11-05', base: 'USD', quote: 'TRY', rate: 50.025 }];
const UNREADABLE = 'Frankfurter answered an unreadable rates table';

let log: MockInstance;
beforeEach(() => {
  log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  log.mockRestore();
  vi.useRealTimers();
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function setup() {
  const clock = new FakeClock(START);
  const reporter = new FakeErrorReporter();
  const fetchFn = vi.fn<typeof fetch>();
  const rates = new FrankfurterExchangeRates(clock, reporter, fetchFn);
  return { clock, reporter, fetchFn, rates };
}

describe('FrankfurterExchangeRates (price conversion design §5.3)', () => {
  it('pins the values fixed by the design', () => {
    expect(FRANKFURTER_RATES_URL).toBe('https://api.frankfurter.dev/v2/rates?base=usd');
    expect(RATES_TIMEOUT_MS).toBe(2_000);
    expect(RATES_FRESH_MS).toBe(6 * HOUR);
    expect(RATES_STALE_MS).toBe(48 * HOUR);
  });

  it('asks for exactly the whole USD table', async () => {
    const { fetchFn, rates } = setup();
    fetchFn.mockResolvedValue(json(TABLE));
    await rates.usdPer('TRY');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://api.frankfurter.dev/v2/rates?base=usd');
    expect(init?.headers).toEqual({ 'user-agent': USER_AGENT, accept: 'application/json' });
    expect(init?.body).toBeUndefined();
  });

  it('answers the rate for a quote, and null for one it does not know', async () => {
    const { fetchFn, rates } = setup();
    fetchFn.mockResolvedValue(json(TABLE));
    expect(await rates.usdPer('TRY')).toBe(50.025);
    expect(await rates.usdPer('XYZ')).toBeNull();
    expect(log).not.toHaveBeenCalled();
  });

  it('ignores keys it does not read', async () => {
    const { fetchFn, rates } = setup();
    fetchFn.mockResolvedValue(json([{ ...TABLE[0], extra: { nested: true } }]));
    expect(await rates.usdPer('TRY')).toBe(50.025);
  });

  it('reuses a fresh table', async () => {
    const { clock, fetchFn, rates } = setup();
    fetchFn.mockImplementation(() => Promise.resolve(json(TABLE)));
    await rates.usdPer('TRY');
    clock.advance(5 * HOUR + 59 * MINUTE);
    expect(await rates.usdPer('TRY')).toBe(50.025);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    clock.advance(2 * MINUTE); // 6 h 01 min after the fetch
    expect(await rates.usdPer('TRY')).toBe(50.025);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('keeps a stale table when a refresh fails, until it is 48 hours old', async () => {
    const { clock, fetchFn, rates } = setup();
    fetchFn.mockResolvedValueOnce(json(TABLE));
    await rates.usdPer('TRY');
    fetchFn.mockImplementation(() => Promise.resolve(json({ error: 'down' }, 500)));
    clock.advance(30 * HOUR);
    expect(await rates.usdPer('TRY')).toBe(50.025);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    clock.advance(18 * HOUR + MINUTE); // 48 h 01 min after the first fetch
    expect(await rates.usdPer('TRY')).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('retries after a failure instead of caching it', async () => {
    const { fetchFn, rates } = setup();
    fetchFn.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect(await rates.usdPer('TRY')).toBeNull();
    fetchFn.mockResolvedValueOnce(json(TABLE));
    expect(await rates.usdPer('TRY')).toBe(50.025);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('shares one refresh between concurrent callers', async () => {
    const { fetchFn, rates } = setup();
    let answer!: (res: Response) => void;
    fetchFn.mockReturnValue(new Promise<Response>((resolve) => (answer = resolve)));
    const calls = [rates.usdPer('TRY'), rates.usdPer('TRY'), rates.usdPer('XYZ')];
    answer(json(TABLE));
    expect(await Promise.all(calls)).toEqual([50.025, 50.025, null]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('gives up after 2 seconds, and a hung request is aborted', async () => {
    vi.useFakeTimers();
    const { fetchFn, rates, reporter } = setup();
    let signal: AbortSignal | null | undefined;
    fetchFn.mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          signal = init?.signal;
          signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const answer = rates.usdPer('TRY');
    await vi.advanceTimersByTimeAsync(RATES_TIMEOUT_MS - 1);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await answer).toBeNull();
    expect(signal?.aborted).toBe(true);
    expect(log).toHaveBeenCalledExactlyOnceWith('fx TIMEOUT');
    expect(reporter.warnings).toEqual([]);
  });

  it('gives up after 2 seconds on a fetch that ignores its signal', async () => {
    vi.useFakeTimers();
    const { fetchFn, rates } = setup();
    fetchFn.mockReturnValue(new Promise<Response>(() => undefined));
    const answer = rates.usdPer('TRY');
    await vi.advanceTimersByTimeAsync(RATES_TIMEOUT_MS);
    expect(await answer).toBeNull();
    expect(log).toHaveBeenCalledExactlyOnceWith('fx TIMEOUT');
  });

  describe('what it logs and reports', () => {
    it.each([
      ['an object', {}],
      ['an empty table', []],
      ['a zero rate', [{ quote: 'TRY', rate: 0 }]],
      ['a negative rate', [{ quote: 'TRY', rate: -1 }]],
      ['a rate that is a string', [{ quote: 'TRY', rate: '50' }]],
      ['a two-letter quote', [{ quote: 'TR', rate: 1 }]],
      ['a lowercase quote', [{ quote: 'try', rate: 1 }]],
    ])('reports %s as an unreadable table, once', async (_name, body) => {
      const { fetchFn, rates, reporter } = setup();
      fetchFn.mockResolvedValue(json(body));
      expect(await rates.usdPer('TRY')).toBeNull();
      expect(reporter.warnings).toEqual([{ message: UNREADABLE, context: undefined }]);
      expect(log).toHaveBeenCalledExactlyOnceWith('fx BAD_ANSWER');
    });

    it('reports a body that is not JSON', async () => {
      const { fetchFn, rates, reporter } = setup();
      fetchFn.mockResolvedValue(new Response('<html>oops</html>', { status: 200 }));
      expect(await rates.usdPer('TRY')).toBeNull();
      expect(reporter.warnings).toHaveLength(1);
      expect(log).toHaveBeenCalledExactlyOnceWith('fx BAD_ANSWER');
    });

    it('logs a 500 with its status and reports nothing', async () => {
      const { fetchFn, rates, reporter } = setup();
      fetchFn.mockResolvedValue(json({}, 500));
      expect(await rates.usdPer('TRY')).toBeNull();
      expect(log).toHaveBeenCalledExactlyOnceWith('fx UNAVAILABLE status=500');
      expect(reporter.warnings).toEqual([]);
      expect(reporter.exceptions).toEqual([]);
    });

    it('logs a rejection with no detail and reports nothing', async () => {
      const { fetchFn, rates, reporter } = setup();
      fetchFn.mockRejectedValue(new TypeError('getaddrinfo ENOTFOUND api.frankfurter.dev'));
      expect(await rates.usdPer('TRY')).toBeNull();
      expect(log).toHaveBeenCalledExactlyOnceWith('fx UNAVAILABLE');
      expect(reporter.warnings).toEqual([]);
      expect(reporter.exceptions).toEqual([]);
    });
  });
});
