SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '30s';--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"claimer_name" text NOT NULL,
	"quantity" integer NOT NULL,
	"manage_token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claims_manage_token_hash_unique" UNIQUE("manage_token_hash"),
	CONSTRAINT "claims_quantity_check" CHECK ("claims"."quantity" >= 1)
);
--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claims_item_id_idx" ON "claims" USING btree ("item_id");