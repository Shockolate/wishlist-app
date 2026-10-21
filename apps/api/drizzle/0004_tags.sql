SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '30s';--> statement-breakpoint
CREATE TABLE "item_tags" (
	"item_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "item_tags_item_id_tag_id_pk" PRIMARY KEY("item_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"wishlist_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_wishlist_id_name_key_unique" UNIQUE("wishlist_id","name_key")
);
--> statement-breakpoint
ALTER TABLE "item_tags" ADD CONSTRAINT "item_tags_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_tags" ADD CONSTRAINT "item_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_wishlist_id_wishlists_id_fk" FOREIGN KEY ("wishlist_id") REFERENCES "public"."wishlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_tags_tag_id_idx" ON "item_tags" USING btree ("tag_id");