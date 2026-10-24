SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '30s';--> statement-breakpoint
CREATE TABLE "claim_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"claim_id" uuid,
	"user_id" uuid NOT NULL,
	"bought_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"gone_at" timestamp with time zone,
	"item_title" text NOT NULL,
	"owner_display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_links_claim_id_unique" UNIQUE("claim_id")
);
--> statement-breakpoint
ALTER TABLE "claim_links" ADD CONSTRAINT "claim_links_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_links" ADD CONSTRAINT "claim_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claim_links_user_id_idx" ON "claim_links" USING btree ("user_id");