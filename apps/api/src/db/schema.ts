import { integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

/** Fixed-window counters for rate limiting (spec §4, §6.6): one row per key per window. */
export const rateLimits = pgTable(
  'rate_limits',
  {
    key: text('key').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull(),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);
