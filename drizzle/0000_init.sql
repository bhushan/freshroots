CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"run_id" uuid,
	"sku_id" text,
	"status" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer,
	"error_code" text,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'success' NOT NULL,
	"analysis_month" text NOT NULL,
	"festival_month" boolean NOT NULL,
	"snapshot_id" integer NOT NULL,
	"snapshot_date" date NOT NULL,
	"config_snapshot" jsonb NOT NULL,
	"summary" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_months" (
	"year_month" text PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"is_festival_month" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_month_range" CHECK ("calendar_months"."month" between 1 and 12)
);
--> statement-breakpoint
CREATE TABLE "distributors" (
	"distributor_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"region" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"dataset" text NOT NULL,
	"content_hash" text NOT NULL,
	"row_count" integer NOT NULL,
	"latest_date" text,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_id" integer NOT NULL,
	"sku_id" text NOT NULL,
	"units_on_hand" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_items_snapshot_sku_unique" UNIQUE("snapshot_id","sku_id"),
	CONSTRAINT "inventory_items_units_check" CHECK ("inventory_items"."units_on_hand" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"location" text NOT NULL,
	"as_of_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_snapshots_location_date_unique" UNIQUE("location","as_of_date")
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"sku_id" text NOT NULL,
	"distinct_weeks" integer NOT NULL,
	"latest_week" text,
	"avg_4wk_raw" numeric(12, 3),
	"avg_12wk_raw" numeric(12, 3),
	"avg_4wk_adjusted" numeric(12, 3),
	"avg_12wk_adjusted" numeric(12, 3),
	"festival_uplift_applied" boolean NOT NULL,
	"units_on_hand" integer,
	"coverage_weeks" numeric(12, 3),
	"flags" jsonb NOT NULL,
	"warnings" jsonb NOT NULL,
	"action" text NOT NULL,
	"suggested_qty" integer,
	"explanation" text NOT NULL,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"final_qty" integer,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommendations_run_sku_unique" UNIQUE("run_id","sku_id"),
	CONSTRAINT "recommendations_status_check" CHECK ("recommendations"."review_status" in ('pending', 'investigating', 'approved', 'rejected', 'overridden')),
	CONSTRAINT "recommendations_qty_check" CHECK ("recommendations"."suggested_qty" is null or "recommendations"."suggested_qty" >= 0),
	CONSTRAINT "recommendations_final_qty_check" CHECK ("recommendations"."final_qty" is null or "recommendations"."final_qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "review_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recommendation_id" uuid NOT NULL,
	"action" text NOT NULL,
	"reviewer" text NOT NULL,
	"prior_status" text NOT NULL,
	"new_status" text NOT NULL,
	"prior_qty" integer,
	"new_qty" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skus" (
	"sku_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"perishability" text NOT NULL,
	"standard_reorder_qty" integer NOT NULL,
	"unit_of_measure" text NOT NULL,
	"distributor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skus_perishability_check" CHECK ("skus"."perishability" in ('Low', 'High')),
	CONSTRAINT "skus_reorder_qty_check" CHECK ("skus"."standard_reorder_qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "weekly_sales" (
	"id" serial PRIMARY KEY NOT NULL,
	"sku_id" text NOT NULL,
	"iso_year" integer NOT NULL,
	"iso_week" integer NOT NULL,
	"units_sold" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_sales_sku_week_unique" UNIQUE("sku_id","iso_year","iso_week"),
	CONSTRAINT "weekly_sales_units_check" CHECK ("weekly_sales"."units_sold" >= 0),
	CONSTRAINT "weekly_sales_week_check" CHECK ("weekly_sales"."iso_week" between 1 and 53)
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_run_id_analysis_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_sku_id_skus_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("sku_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_snapshot_id_inventory_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."inventory_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_snapshot_id_inventory_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."inventory_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_sku_id_skus_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("sku_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_run_id_analysis_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_sku_id_skus_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("sku_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_actions" ADD CONSTRAINT "review_actions_recommendation_id_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skus" ADD CONSTRAINT "skus_distributor_id_distributors_distributor_id_fk" FOREIGN KEY ("distributor_id") REFERENCES "public"."distributors"("distributor_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_sales" ADD CONSTRAINT "weekly_sales_sku_id_skus_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("sku_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_created_idx" ON "ai_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_lookup_idx" ON "ai_usage" USING btree ("kind","run_id","sku_id");--> statement-breakpoint
CREATE INDEX "inventory_items_sku_idx" ON "inventory_items" USING btree ("sku_id");--> statement-breakpoint
CREATE INDEX "recommendations_run_status_idx" ON "recommendations" USING btree ("run_id","review_status");--> statement-breakpoint
CREATE INDEX "review_actions_rec_idx" ON "review_actions" USING btree ("recommendation_id","created_at");--> statement-breakpoint
CREATE INDEX "skus_distributor_idx" ON "skus" USING btree ("distributor_id");