SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '30s';--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"wishlist_id" uuid NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"image_url" text,
	"price_text" text,
	"note" text,
	"quantity" integer NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_quantity_check" CHECK ("items"."quantity" between 1 and 99)
);
--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_wishlist_id_wishlists_id_fk" FOREIGN KEY ("wishlist_id") REFERENCES "public"."wishlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "items_wishlist_id_position_idx" ON "items" USING btree ("wishlist_id","position");