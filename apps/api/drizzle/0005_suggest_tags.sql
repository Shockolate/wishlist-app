SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '30s';--> statement-breakpoint
ALTER TABLE "wishlists" ADD COLUMN "suggest_tags" boolean DEFAULT true NOT NULL;
