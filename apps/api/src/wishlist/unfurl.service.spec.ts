import { describe, expect, it } from 'vitest';
import type { Database } from '../db/database.module.js';
import type { RateLimiter } from '../rate-limit/rate-limiter.js';
import { FakeExchangeRates, FakeMetadataFetcher } from '../testing/fakes.js';
import { UnfurlService } from './unfurl.service.js';

const TRY_PRICE = {
  title: 'Walnut table',
  priceText: 'TRY 45,000.00',
  price: { amount: '45000.00', currency: 'TRY' },
};

/** The one query the service makes: `select().from().where()` answering `rows`, or rejecting. */
function stubDb(outcome: { rows: unknown[] } | { error: Error }): Database {
  const query = {
    from: () => query,
    where: () =>
      'error' in outcome ? Promise.reject(outcome.error) : Promise.resolve(outcome.rows),
  };
  return { select: () => query } as unknown as Database;
}

function setup(db: Database) {
  const fetcher = new FakeMetadataFetcher();
  const rates = new FakeExchangeRates();
  rates.rates.set('TRY', 50.025);
  fetcher.next = { ...TRY_PRICE };
  const limiter = { enforce: () => Promise.resolve() } as unknown as RateLimiter;
  return { rates, service: new UnfurlService(limiter, fetcher, db, rates) };
}

describe('UnfurlService reading the convert-prices setting (price conversion design §5.4)', () => {
  it('converts when the read says yes', async () => {
    const { service } = setup(stubDb({ rows: [{ convertPrices: true }] }));
    expect(await service.unfurl('user-1', 'https://shop.example/table')).toEqual({
      title: 'Walnut table',
      priceText: '$899.55',
      convertedFrom: 'TRY 45,000.00',
    });
  });

  it('still answers the unconverted prefill when the read throws', async () => {
    const { rates, service } = setup(stubDb({ error: new Error('connection terminated') }));
    const res = await service.unfurl('user-1', 'https://shop.example/table');
    expect(res).toEqual({ title: 'Walnut table', priceText: 'TRY 45,000.00' });
    expect(res).not.toHaveProperty('price');
    expect(res).not.toHaveProperty('convertedFrom');
    expect(rates.asked).toEqual([]);
  });
});
