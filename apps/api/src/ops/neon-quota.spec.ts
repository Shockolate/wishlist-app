import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeClock, FakeCronHeartbeat, FakeErrorReporter } from '../testing/fakes.js';
import { judgeQuota, NeonQuotaCheck, NO_QUOTA_CHECK } from './neon-quota.js';

const DAY = 24 * 60 * 60 * 1000;
const START = new Date('2026-11-01T00:00:00Z');
const END = new Date('2026-12-01T00:00:00Z');
const PROJECT = 'steep-dew-42117248';
const KEY = 'napi_SECRETKEY';

const reading = (usedCuHours: number) => ({ usedCuHours, periodStart: START, periodEnd: END });
const at = (days: number) => new Date(START.getTime() + days * DAY);

describe('judgeQuota (D105)', () => {
  it('is under with a light month: 10 CU-hours by day 10 projects 30', () => {
    expect(judgeQuota(reading(10), at(10))).toEqual({
      usedCuHours: 10,
      projectedCuHours: 30,
      over: false,
    });
  });

  it('is over at 60 CU-hours used, whatever the projection', () => {
    expect(judgeQuota(reading(60), at(29)).over).toBe(true);
    expect(judgeQuota(reading(59.9), at(29)).over).toBe(false);
  });

  it('is over when the trend projects 90 or more', () => {
    expect(judgeQuota(reading(12), at(4))).toMatchObject({ projectedCuHours: 90, over: true });
  });

  it('does not project in the first 3 days', () => {
    expect(judgeQuota(reading(10), at(2.9))).toEqual({
      usedCuHours: 10,
      projectedCuHours: undefined,
      over: false,
    });
  });
});

function fakeFetch(respond: (signal?: AbortSignal | null) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve().then(() => respond(init.signal));
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const project = (computeSeconds: number) =>
  Response.json({
    project: {
      id: PROJECT,
      compute_time_seconds: computeSeconds,
      consumption_period_start: START.toISOString(),
      consumption_period_end: END.toISOString(),
    },
  });

function setUp(respond: Parameters<typeof fakeFetch>[0], now = at(10)) {
  const heartbeat = new FakeCronHeartbeat();
  const reporter = new FakeErrorReporter();
  const fetch = fakeFetch(respond);
  const check = new NeonQuotaCheck(PROJECT, KEY, heartbeat, reporter, new FakeClock(now), fetch.fn);
  return { check, heartbeat, reporter, fetch };
}

describe('NeonQuotaCheck (D105)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the project with the key, and pings succeeded when under', async () => {
    const { check, heartbeat, reporter, fetch } = setUp(() => project(10 * 3600));
    await check.run();
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0]?.url).toBe(`https://console.neon.tech/api/v2/projects/${PROJECT}`);
    expect(fetch.calls[0]?.init.method).toBe('GET');
    expect(new Headers(fetch.calls[0]?.init.headers).get('authorization')).toBe(`Bearer ${KEY}`);
    expect(heartbeat.pings).toEqual(['succeeded']);
    expect(reporter.warnings).toEqual([]);
  });

  it('pings failed when over', async () => {
    const { check, heartbeat } = setUp(() => project(60 * 3600));
    await check.run();
    expect(heartbeat.pings).toEqual(['failed']);
  });

  it('pings nothing and warns with the status only on a non-2xx', async () => {
    const { check, heartbeat, reporter } = setUp(
      () => new Response(`bad key ${KEY}`, { status: 401 }),
    );
    await expect(check.run()).resolves.toBeUndefined();
    expect(heartbeat.pings).toEqual([]);
    expect(reporter.warnings).toEqual([{ message: 'neon quota check failed status=401' }]);
  });

  it('pings nothing and warns on a body it does not expect', async () => {
    const { check, heartbeat, reporter } = setUp(() => Response.json({ project: { id: PROJECT } }));
    await check.run();
    expect(heartbeat.pings).toEqual([]);
    expect(reporter.warnings).toEqual([{ message: 'neon quota check failed status=invalid' }]);
  });

  it('does not leak the key when fetch rejects with it in the message', async () => {
    const { check, heartbeat, reporter } = setUp(() => {
      throw new TypeError(`fetch failed ${KEY}`, { cause: new Error(KEY) });
    });
    await expect(check.run()).resolves.toBeUndefined();
    expect(heartbeat.pings).toEqual([]);
    expect(reporter.warnings).toEqual([{ message: 'neon quota check failed status=none' }]);
    expect(JSON.stringify(reporter)).not.toContain('SECRETKEY');
  });

  it('gives up after 5 seconds and warns status=none', async () => {
    vi.useFakeTimers();
    const { check, heartbeat, reporter } = setUp(
      (signal) =>
        new Promise<Response>((_, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason as Error));
        }),
    );
    const run = check.run();
    await vi.advanceTimersByTimeAsync(4999);
    expect(reporter.warnings).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await expect(run).resolves.toBeUndefined();
    expect(heartbeat.pings).toEqual([]);
    expect(reporter.warnings).toEqual([{ message: 'neon quota check failed status=none' }]);
  });
});

describe('NO_QUOTA_CHECK', () => {
  it('resolves without doing anything', async () => {
    await expect(NO_QUOTA_CHECK.run()).resolves.toBeUndefined();
  });
});
