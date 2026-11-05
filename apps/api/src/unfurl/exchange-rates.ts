import { Logger } from '@nestjs/common';
import { z } from 'zod';
import type { Clock } from '../core/clock.js';
import type { ErrorReporter } from '../observability/error-reporter.js';
import { USER_AGENT } from './page-fetcher.js';

/**
 * The exchange rate port and its Frankfurter adapter (price conversion design §5.3).
 *
 * Frankfurter's `GET /v2/rates?base=usd` answers a JSON array of `{ date, base: "USD", quote, rate }`
 * (checked 2026-11-05: 181 entries, TRY among them). `rate` is units of `quote` per 1 USD, so dollars
 * are the amount divided by it. The URL is fixed and carries nothing about an item, an amount, a
 * currency or a person: one table serves every paste, and is kept in memory.
 */

/** Dollars-per-unit lookups. Never throws; `null` means "no usable rate", and the caller leaves the price alone. */
export interface ExchangeRates {
  /** Units of `currency` per 1 USD (an ISO 4217 code in capitals), or null when there's no usable rate. */
  usdPer(currency: string): Promise<number | null>;
}

export const EXCHANGE_RATES = Symbol('EXCHANGE_RATES');

export const FRANKFURTER_RATES_URL = 'https://api.frankfurter.dev/v2/rates?base=usd';
export const RATES_TIMEOUT_MS = 2_000;
/** A table younger than this is used without asking Frankfurter again. */
export const RATES_FRESH_MS = 6 * 3_600_000;
/** If a refresh fails, a table up to this old is still used. */
export const RATES_STALE_MS = 48 * 3_600_000;

const HEADERS = { 'user-agent': USER_AGENT, accept: 'application/json' };

/** Other keys (`date`, `base`) are ignored. One bad entry spoils the table: a half-trusted table is worse than none. */
const RatesAnswerSchema = z
  .array(z.object({ quote: z.string().regex(/^[A-Z]{3}$/), rate: z.number().positive().finite() }))
  .min(1);

type Download =
  | { kind: 'ok'; rates: Map<string, number> }
  | { kind: 'bad-answer' }
  | { kind: 'timeout' }
  | { kind: 'unavailable'; status?: number };

const logger = new Logger('ExchangeRates');

/**
 * The real adapter: one in-memory table per process. Concurrent callers share one refresh, and a failed
 * refresh is not remembered, so the next call asks again. Logs carry only the outcome and the HTTP
 * status (`fx UNAVAILABLE status=500`, `fx TIMEOUT`, `fx BAD_ANSWER`), never a currency, amount or URL.
 * Only a malformed answer is reported (Sentry): an outage on their side isn't ours to fix.
 */
export class FrankfurterExchangeRates implements ExchangeRates {
  private table: { fetchedAt: number; rates: Map<string, number> } | null = null;
  private refreshing: Promise<void> | null = null;

  constructor(
    private readonly clock: Clock,
    private readonly reporter: ErrorReporter,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async usdPer(currency: string): Promise<number | null> {
    if (!this.isFresh()) {
      this.refreshing ??= this.refresh().finally(() => {
        this.refreshing = null;
      });
      await this.refreshing;
    }
    const { table } = this;
    if (table === null || this.clock.now().getTime() - table.fetchedAt > RATES_STALE_MS)
      return null;
    return table.rates.get(currency) ?? null;
  }

  private isFresh(): boolean {
    return (
      this.table !== null && this.clock.now().getTime() - this.table.fetchedAt < RATES_FRESH_MS
    );
  }

  /** Replaces the table on success; on any failure logs, leaves the old table, and resolves. */
  private async refresh(): Promise<void> {
    const result = await this.download();
    switch (result.kind) {
      case 'ok':
        this.table = { fetchedAt: this.clock.now().getTime(), rates: result.rates };
        return;
      case 'bad-answer':
        this.reporter.captureWarning('Frankfurter answered an unreadable rates table');
        logger.log('fx BAD_ANSWER');
        return;
      case 'timeout':
        logger.log('fx TIMEOUT');
        return;
      case 'unavailable':
        logger.log(
          result.status === undefined ? 'fx UNAVAILABLE' : `fx UNAVAILABLE status=${result.status}`,
        );
        return;
    }
  }

  /**
   * The deadline aborts the request and is also raced here, so a `fetchFn` that ignores its signal
   * can't hold a paste. A plain timer (not `AbortSignal.timeout`) so tests can drive it with fake timers.
   */
  private async download(): Promise<Download> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<Download>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ kind: 'timeout' });
      }, RATES_TIMEOUT_MS);
    });
    try {
      return await Promise.race([this.request(controller.signal), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async request(signal: AbortSignal): Promise<Download> {
    let status: number | undefined;
    try {
      const res = await this.fetchFn(FRANKFURTER_RATES_URL, { headers: HEADERS, signal });
      status = res.status;
      if (status !== 200) return { kind: 'unavailable', status };
      const body = await res.text();
      const parsed = RatesAnswerSchema.safeParse(parseJson(body));
      if (!parsed.success) return { kind: 'bad-answer' };
      return { kind: 'ok', rates: new Map(parsed.data.map((entry) => [entry.quote, entry.rate])) };
    } catch {
      if (signal.aborted) return { kind: 'timeout' };
      return status === undefined ? { kind: 'unavailable' } : { kind: 'unavailable', status };
    }
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
