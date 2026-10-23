import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { ActionCode, RuleFlag } from "@/lib/rules/engine";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const distributors = pgTable("distributors", {
  distributorId: text("distributor_id").primaryKey(),
  name: text("name").notNull(),
  region: text("region").notNull(),
  status: text("status").notNull(),
  /** Cached Zoho Books vendor (contact) id, resolved by name on first order. Set by hand to override. */
  zohoVendorId: text("zoho_vendor_id"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const skus = pgTable(
  "skus",
  {
    skuId: text("sku_id").primaryKey(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    perishability: text("perishability").notNull(),
    standardReorderQty: integer("standard_reorder_qty").notNull(),
    unitOfMeasure: text("unit_of_measure").notNull(),
    distributorId: text("distributor_id")
      .notNull()
      .references(() => distributors.distributorId),
    /** Cached Zoho Books item id, resolved by SKU code on first order. Set by hand to override. */
    zohoItemId: text("zoho_item_id"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("skus_perishability_check", sql`${t.perishability} in ('Low', 'High')`),
    check("skus_reorder_qty_check", sql`${t.standardReorderQty} > 0`),
    index("skus_distributor_idx").on(t.distributorId),
  ],
);

export const calendarMonths = pgTable(
  "calendar_months",
  {
    yearMonth: text("year_month").primaryKey(),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    isFestivalMonth: boolean("is_festival_month").notNull(),
    createdAt: createdAt(),
  },
  (t) => [check("calendar_month_range", sql`${t.month} between 1 and 12`)],
);

export const weeklySales = pgTable(
  "weekly_sales",
  {
    id: serial("id").primaryKey(),
    skuId: text("sku_id")
      .notNull()
      .references(() => skus.skuId),
    isoYear: integer("iso_year").notNull(),
    isoWeek: integer("iso_week").notNull(),
    unitsSold: integer("units_sold").notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("weekly_sales_sku_week_unique").on(t.skuId, t.isoYear, t.isoWeek),
    check("weekly_sales_units_check", sql`${t.unitsSold} >= 0`),
    check("weekly_sales_week_check", sql`${t.isoWeek} between 1 and 53`),
  ],
);

export const inventorySnapshots = pgTable(
  "inventory_snapshots",
  {
    id: serial("id").primaryKey(),
    location: text("location").notNull(),
    asOfDate: date("as_of_date", { mode: "string" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("inventory_snapshots_location_date_unique").on(t.location, t.asOfDate)],
);

export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: serial("id").primaryKey(),
    snapshotId: integer("snapshot_id")
      .notNull()
      .references(() => inventorySnapshots.id, { onDelete: "cascade" }),
    skuId: text("sku_id")
      .notNull()
      .references(() => skus.skuId),
    unitsOnHand: integer("units_on_hand").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("inventory_items_snapshot_sku_unique").on(t.snapshotId, t.skuId),
    check("inventory_items_units_check", sql`${t.unitsOnHand} >= 0`),
    index("inventory_items_sku_idx").on(t.skuId),
  ],
);

/** One row per successful import: powers the "latest date / imported at" data status panel. */
export const importBatches = pgTable("import_batches", {
  id: serial("id").primaryKey(),
  dataset: text("dataset").notNull(),
  contentHash: text("content_hash").notNull(),
  rowCount: integer("row_count").notNull(),
  latestDate: text("latest_date"),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
});

export const analysisRuns = pgTable("analysis_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  status: text("status").notNull().default("success"),
  /** "YYYY-MM" the festival rule was evaluated for (month of the inventory snapshot). */
  analysisMonth: text("analysis_month").notNull(),
  festivalMonth: boolean("festival_month").notNull(),
  snapshotId: integer("snapshot_id")
    .notNull()
    .references(() => inventorySnapshots.id),
  snapshotDate: date("snapshot_date", { mode: "string" }).notNull(),
  /** Thresholds in force for this run, so history stays auditable if the rules change. */
  configSnapshot: jsonb("config_snapshot").notNull(),
  summary: jsonb("summary").notNull(),
  createdAt: createdAt(),
});

export const REVIEW_STATUSES = ["pending", "investigating", "approved", "rejected", "overridden"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

const num = (name: string, precision = 12, scale = 3) => numeric(name, { precision, scale, mode: "number" });

export const recommendations = pgTable(
  "recommendations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => analysisRuns.id, { onDelete: "cascade" }),
    skuId: text("sku_id")
      .notNull()
      .references(() => skus.skuId),
    distinctWeeks: integer("distinct_weeks").notNull(),
    latestWeek: text("latest_week"),
    avg4Raw: num("avg_4wk_raw"),
    avg12Raw: num("avg_12wk_raw"),
    avg4Adjusted: num("avg_4wk_adjusted"),
    avg12Adjusted: num("avg_12wk_adjusted"),
    festivalUpliftApplied: boolean("festival_uplift_applied").notNull(),
    unitsOnHand: integer("units_on_hand"),
    coverageWeeks: num("coverage_weeks", 12, 3),
    flags: jsonb("flags").$type<RuleFlag[]>().notNull(),
    warnings: jsonb("warnings").$type<string[]>().notNull(),
    action: text("action").$type<ActionCode>().notNull(),
    /** null = manual review, no executable quantity. */
    suggestedQty: integer("suggested_qty"),
    explanation: text("explanation").notNull(),
    reviewStatus: text("review_status").$type<ReviewStatus>().notNull().default("pending"),
    /** Quantity after human review (approved = suggested, overridden = planner value). */
    finalQty: integer("final_qty"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("recommendations_run_sku_unique").on(t.runId, t.skuId),
    index("recommendations_run_status_idx").on(t.runId, t.reviewStatus),
    check(
      "recommendations_status_check",
      sql`${t.reviewStatus} in ('pending', 'investigating', 'approved', 'rejected', 'overridden')`,
    ),
    check("recommendations_qty_check", sql`${t.suggestedQty} is null or ${t.suggestedQty} >= 0`),
    check("recommendations_final_qty_check", sql`${t.finalQty} is null or ${t.finalQty} >= 0`),
  ],
);

export const reviewActions = pgTable(
  "review_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recommendationId: uuid("recommendation_id")
      .notNull()
      .references(() => recommendations.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    reviewer: text("reviewer").notNull(),
    priorStatus: text("prior_status").$type<ReviewStatus>().notNull(),
    newStatus: text("new_status").$type<ReviewStatus>().notNull(),
    priorQty: integer("prior_qty"),
    newQty: integer("new_qty"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("review_actions_rec_idx").on(t.recommendationId, t.createdAt)],
);

export const PO_STATUSES = ["pending", "created", "failed"] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

/**
 * One Zoho Books purchase order per approved or overridden recommendation. The row is written in the same
 * transaction as the decision (pending), then the Zoho call happens afterwards, so a Zoho outage never undoes
 * a planner decision and a failed order can be retried without creating a duplicate.
 */
export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recommendationId: uuid("recommendation_id")
      .notNull()
      .references(() => recommendations.id, { onDelete: "cascade" }),
    status: text("status").$type<PoStatus>().notNull().default("pending"),
    qty: integer("qty").notNull(),
    /** Sent to Zoho as reference_number; lets a retry find an order that was created but not recorded. */
    reference: text("reference").notNull(),
    zohoPoId: text("zoho_po_id"),
    zohoPoNumber: text("zoho_po_number"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("purchase_orders_recommendation_unique").on(t.recommendationId),
    check("purchase_orders_status_check", sql`${t.status} in ('pending', 'created', 'failed')`),
    check("purchase_orders_qty_check", sql`${t.qty} > 0`),
  ],
);

export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    runId: uuid("run_id").references(() => analysisRuns.id, { onDelete: "cascade" }),
    skuId: text("sku_id").references(() => skus.skuId),
    /** ok | error | throttled | quota */
    status: text("status").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    latencyMs: integer("latency_ms"),
    errorCode: text("error_code"),
    /** Validated response, reused so repeat clicks do not spend free-tier quota. */
    response: jsonb("response"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_usage_created_idx").on(t.createdAt), index("ai_usage_lookup_idx").on(t.kind, t.runId, t.skuId)],
);
