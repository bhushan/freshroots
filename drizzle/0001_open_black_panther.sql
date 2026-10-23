CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recommendation_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"qty" integer NOT NULL,
	"reference" text NOT NULL,
	"zoho_po_id" text,
	"zoho_po_number" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_recommendation_unique" UNIQUE("recommendation_id"),
	CONSTRAINT "purchase_orders_status_check" CHECK ("purchase_orders"."status" in ('pending', 'created', 'failed')),
	CONSTRAINT "purchase_orders_qty_check" CHECK ("purchase_orders"."qty" > 0)
);
--> statement-breakpoint
ALTER TABLE "distributors" ADD COLUMN "zoho_vendor_id" text;--> statement-breakpoint
ALTER TABLE "skus" ADD COLUMN "zoho_item_id" text;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_recommendation_id_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE cascade ON UPDATE no action;