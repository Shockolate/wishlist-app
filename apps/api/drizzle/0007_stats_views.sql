-- Aggregate usage views and the role that may read them (D102, design 2026-10-28). Every view
-- returns counts, sums, averages or week buckets, never a person's data. The views run with their
-- owner's rights (no security_invoker), so stats_reader reads them with no grant on the tables.
-- Dropping or renaming a column a view uses means recreating that view here, and re-granting it.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '30s';--> statement-breakpoint
-- Roles belong to the cluster (on Neon, the branch), so one may already exist from another database.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'stats_reader') THEN
    CREATE ROLE stats_reader NOLOGIN;
  END IF;
END
$$;--> statement-breakpoint
CREATE SCHEMA stats;--> statement-breakpoint
CREATE VIEW stats.overview AS
WITH list_sizes AS (
  SELECT wishlist_id, count(*)::int AS n FROM items GROUP BY wishlist_id
), claimed AS (
  -- An item claimed past what the owner now wants counts once.
  SELECT i.wishlist_id, least(sum(c.quantity), i.quantity) AS units
  FROM items i JOIN claims c ON c.item_id = i.id
  GROUP BY i.id
)
SELECT
  (SELECT count(*) FROM users)::int AS accounts,
  (SELECT count(*) FROM users WHERE email_verified_at IS NOT NULL)::int AS verified_accounts,
  (SELECT count(*) FROM list_sizes)::int AS lists_with_items,
  (SELECT count(*) FROM items)::int AS items,
  (SELECT count(*) FROM items WHERE url IS NULL)::int AS ideas,
  (SELECT count(*) FROM items WHERE url IS NOT NULL)::int AS link_items,
  (SELECT count(DISTINCT item_id) FROM item_tags)::int AS items_with_tags,
  (SELECT count(*) FROM tags)::int AS tags,
  (SELECT round(avg(n), 1) FROM list_sizes) AS avg_items_per_list,
  (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY n))::numeric, 1) FROM list_sizes)
    AS median_items_per_list,
  (SELECT max(n) FROM list_sizes) AS max_items_per_list,
  (SELECT count(*) FROM claims)::int AS claims,
  (SELECT coalesce(sum(units), 0) FROM claimed)::int AS claimed_units,
  (SELECT coalesce(sum(quantity), 0) FROM items)::int AS wanted_units,
  (SELECT round(coalesce(sum(units), 0)::numeric / nullif((SELECT sum(quantity) FROM items), 0), 2)
     FROM claimed) AS claimed_share,
  (SELECT count(DISTINCT wishlist_id) FROM claimed)::int AS lists_with_claims,
  -- A link whose claim is gone is a note, not a linked claim.
  (SELECT count(*) FROM claim_links WHERE claim_id IS NOT NULL)::int AS linked_claims,
  (SELECT count(*) FROM claim_links WHERE claim_id IS NOT NULL AND bought_at IS NOT NULL)::int
    AS bought_ticks,
  (SELECT count(*) FROM wishlists WHERE show_claims_to_owner)::int AS owners_showing_claims,
  (SELECT count(*) FROM wishlists WHERE suggest_tags)::int AS lists_suggesting_tags;--> statement-breakpoint
CREATE VIEW stats.accounts_weekly AS
WITH signups AS (
  SELECT date_trunc('week', created_at AT TIME ZONE 'UTC')::date AS week, count(*)::int AS n
  FROM users GROUP BY 1
), verifications AS (
  SELECT date_trunc('week', email_verified_at AT TIME ZONE 'UTC')::date AS week, count(*)::int AS n
  FROM users WHERE email_verified_at IS NOT NULL GROUP BY 1
)
SELECT coalesce(s.week, v.week) AS week, coalesce(s.n, 0) AS signups, coalesce(v.n, 0) AS verifications
FROM signups s FULL OUTER JOIN verifications v ON v.week = s.week
ORDER BY 1 DESC;--> statement-breakpoint
CREATE VIEW stats.claims_weekly AS
SELECT date_trunc('week', created_at AT TIME ZONE 'UTC')::date AS week,
  count(*)::int AS claims,
  sum(quantity)::int AS units
FROM claims GROUP BY 1
ORDER BY 1 DESC;--> statement-breakpoint
COMMENT ON VIEW stats.overview IS 'Aggregates only (D102). Deleted accounts, items and claims leave no trace.';--> statement-breakpoint
COMMENT ON VIEW stats.accounts_weekly IS 'Aggregates only (D102). Counts what still exists: deleted accounts leave no trace, and unverified accounts are purged after 7 days, so past weeks count only verified sign-ups.';--> statement-breakpoint
COMMENT ON VIEW stats.claims_weekly IS 'Aggregates only (D102). Counts claims that still exist, in the week each was made; a later quantity change stays in that week.';--> statement-breakpoint
GRANT USAGE ON SCHEMA stats TO stats_reader;--> statement-breakpoint
-- Explicit, never by default privileges: a view a later migration adds is granted there, by name.
GRANT SELECT ON ALL TABLES IN SCHEMA stats TO stats_reader;
