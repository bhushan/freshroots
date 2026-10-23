import { and, asc, count, desc, eq, isNull, max, ne } from "drizzle-orm";
import * as t from "@/db/schema";
import type { Db } from "@/db/store";
import { explainOutput, summaryOutput, type ExplainOutput, type SummaryOutput } from "@/lib/ai/schema";
import { getLatestRun, type RunSummary } from "@/lib/analysis/run";

/** Read models for the pages. Dates are serialised to strings so results can cross to client components. */

export interface ShellInfo {
  snapshotDate: string | null;
  analysedAt: string | null;
  pending: number;
}

export async function getShellInfo(db: Db): Promise<ShellInfo> {
  const run = await getLatestRun(db);
  if (!run) return { snapshotDate: null, analysedAt: null, pending: 0 };
  const [{ n }] = await db
    .select({ n: count() })
    .from(t.recommendations)
    .where(and(eq(t.recommendations.runId, run.id), eq(t.recommendations.reviewStatus, "pending"), ne(t.recommendations.action, "MAINTAIN_MONITOR")));
  return { snapshotDate: run.snapshotDate, analysedAt: run.createdAt.toISOString(), pending: n };
}

export interface DatasetStatus {
  dataset: string;
  rows: number;
  latestDate: string | null;
  importedAt: string | null;
}

export async function getDataStatus(db: Db): Promise<DatasetStatus[]> {
  const [d, c, s, w, i, batches] = await Promise.all([
    db.select({ n: count() }).from(t.distributors),
    db.select({ n: count() }).from(t.calendarMonths),
    db.select({ n: count() }).from(t.skus),
    db.select({ n: count() }).from(t.weeklySales),
    db.select({ n: count() }).from(t.inventoryItems),
    db
      .select({ dataset: t.importBatches.dataset, importedAt: max(t.importBatches.importedAt), latestDate: max(t.importBatches.latestDate) })
      .from(t.importBatches)
      .groupBy(t.importBatches.dataset),
  ]);
  const byDataset = new Map(batches.map((b) => [b.dataset, b]));
  return [
    ["distributors", d[0].n],
    ["calendar", c[0].n],
    ["skus", s[0].n],
    ["weekly_sales", w[0].n],
    ["inventory", i[0].n],
  ].map(([dataset, rows]) => ({
    dataset: dataset as string,
    rows: rows as number,
    latestDate: byDataset.get(dataset as string)?.latestDate ?? null,
    importedAt: byDataset.get(dataset as string)?.importedAt?.toISOString() ?? null,
  }));
}

export interface RecRow {
  id: string;
  skuId: string;
  skuName: string;
  category: string;
  perishability: "Low" | "High";
  standardReorderQty: number;
  avg4Raw: number | null;
  avg12Raw: number | null;
  avg4Adjusted: number | null;
  avg12Adjusted: number | null;
  festivalUpliftApplied: boolean;
  unitsOnHand: number | null;
  coverageWeeks: number | null;
  flags: (typeof t.recommendations.$inferSelect)["flags"];
  warnings: string[];
  action: (typeof t.recommendations.$inferSelect)["action"];
  suggestedQty: number | null;
  finalQty: number | null;
  reviewStatus: t.ReviewStatus;
  distinctWeeks: number;
  latestWeek: string | null;
  explanation: string;
}

const recColumns = {
  id: t.recommendations.id,
  skuId: t.recommendations.skuId,
  skuName: t.skus.name,
  category: t.skus.category,
  perishability: t.skus.perishability,
  standardReorderQty: t.skus.standardReorderQty,
  avg4Raw: t.recommendations.avg4Raw,
  avg12Raw: t.recommendations.avg12Raw,
  avg4Adjusted: t.recommendations.avg4Adjusted,
  avg12Adjusted: t.recommendations.avg12Adjusted,
  festivalUpliftApplied: t.recommendations.festivalUpliftApplied,
  unitsOnHand: t.recommendations.unitsOnHand,
  coverageWeeks: t.recommendations.coverageWeeks,
  flags: t.recommendations.flags,
  warnings: t.recommendations.warnings,
  action: t.recommendations.action,
  suggestedQty: t.recommendations.suggestedQty,
  finalQty: t.recommendations.finalQty,
  reviewStatus: t.recommendations.reviewStatus,
  distinctWeeks: t.recommendations.distinctWeeks,
  latestWeek: t.recommendations.latestWeek,
  explanation: t.recommendations.explanation,
};

export async function getRecRows(db: Db, runId: string): Promise<RecRow[]> {
  const rows = await db
    .select(recColumns)
    .from(t.recommendations)
    .innerJoin(t.skus, eq(t.skus.skuId, t.recommendations.skuId))
    .where(eq(t.recommendations.runId, runId))
    .orderBy(asc(t.recommendations.skuId));
  return rows as RecRow[];
}

export interface RunInfo {
  id: string;
  analysisMonth: string;
  festivalMonth: boolean;
  snapshotDate: string;
  createdAt: string;
  summary: RunSummary;
  festivalUplift: number;
}

export async function getRunInfo(db: Db): Promise<RunInfo | null> {
  const run = await getLatestRun(db);
  if (!run) return null;
  const config = run.configSnapshot as { festivalUplift?: number };
  return {
    id: run.id,
    analysisMonth: run.analysisMonth,
    festivalMonth: run.festivalMonth,
    snapshotDate: run.snapshotDate,
    createdAt: run.createdAt.toISOString(),
    summary: run.summary as RunSummary,
    festivalUplift: config.festivalUplift ?? 1.25,
  };
}

/** Previously generated commentary for the latest run. Reading it never calls Gemini. */
export async function getCachedSummary(db: Db, runId: string): Promise<SummaryOutput | null> {
  const [row] = await db
    .select({ response: t.aiUsage.response })
    .from(t.aiUsage)
    .where(and(eq(t.aiUsage.kind, "summary"), eq(t.aiUsage.runId, runId), isNull(t.aiUsage.skuId), eq(t.aiUsage.status, "ok")))
    .orderBy(desc(t.aiUsage.createdAt))
    .limit(1);
  const parsed = summaryOutput.safeParse(row?.response);
  return parsed.success ? parsed.data : null;
}

export async function getCachedExplanation(db: Db, runId: string, skuId: string): Promise<ExplainOutput | null> {
  const [row] = await db
    .select({ response: t.aiUsage.response })
    .from(t.aiUsage)
    .where(and(eq(t.aiUsage.kind, "explain"), eq(t.aiUsage.runId, runId), eq(t.aiUsage.skuId, skuId), eq(t.aiUsage.status, "ok")))
    .orderBy(desc(t.aiUsage.createdAt))
    .limit(1);
  const parsed = explainOutput.safeParse(row?.response);
  return parsed.success ? parsed.data : null;
}

export interface SalesPoint {
  week: string;
  units: number;
}

export async function getSalesSeries(db: Db, skuId: string): Promise<SalesPoint[]> {
  const rows = await db
    .select({ isoYear: t.weeklySales.isoYear, isoWeek: t.weeklySales.isoWeek, units: t.weeklySales.unitsSold })
    .from(t.weeklySales)
    .where(eq(t.weeklySales.skuId, skuId))
    .orderBy(asc(t.weeklySales.isoYear), asc(t.weeklySales.isoWeek));
  return rows.map((r) => ({ week: `${r.isoYear}-W${String(r.isoWeek).padStart(2, "0")}`, units: r.units }));
}

export async function getSkuDetail(db: Db, skuId: string) {
  const run = await getRunInfo(db);
  if (!run) return null;
  const [rec] = await db
    .select(recColumns)
    .from(t.recommendations)
    .innerJoin(t.skus, eq(t.skus.skuId, t.recommendations.skuId))
    .where(and(eq(t.recommendations.runId, run.id), eq(t.recommendations.skuId, skuId)));
  if (!rec) return null;
  const [sales, history, cached, distributor] = await Promise.all([
    getSalesSeries(db, skuId),
    db
      .select()
      .from(t.reviewActions)
      .where(eq(t.reviewActions.recommendationId, rec.id))
      .orderBy(desc(t.reviewActions.createdAt)),
    getCachedExplanation(db, run.id, skuId),
    db
      .select({ name: t.distributors.name, region: t.distributors.region })
      .from(t.skus)
      .innerJoin(t.distributors, eq(t.distributors.distributorId, t.skus.distributorId))
      .where(eq(t.skus.skuId, skuId))
      .limit(1),
  ]);
  return {
    run,
    rec: rec as RecRow,
    sales,
    cachedExplanation: cached,
    distributor: distributor[0] ?? null,
    history: history.map((h) => ({
      id: h.id,
      action: h.action,
      reviewer: h.reviewer,
      priorStatus: h.priorStatus,
      newStatus: h.newStatus,
      priorQty: h.priorQty,
      newQty: h.newQty,
      note: h.note,
      createdAt: h.createdAt.toISOString(),
    })),
  };
}

export interface PurchaseOrderInfo {
  status: t.PoStatus;
  number: string | null;
  error: string | null;
  qty: number;
}

export async function getReviewBoard(db: Db) {
  const run = await getRunInfo(db);
  if (!run) return null;
  const [rows, actions, orders] = await Promise.all([
    getRecRows(db, run.id),
    db
      .select({
        id: t.reviewActions.id,
        recommendationId: t.reviewActions.recommendationId,
        action: t.reviewActions.action,
        reviewer: t.reviewActions.reviewer,
        priorStatus: t.reviewActions.priorStatus,
        newStatus: t.reviewActions.newStatus,
        priorQty: t.reviewActions.priorQty,
        newQty: t.reviewActions.newQty,
        note: t.reviewActions.note,
        createdAt: t.reviewActions.createdAt,
      })
      .from(t.reviewActions)
      .innerJoin(t.recommendations, eq(t.recommendations.id, t.reviewActions.recommendationId))
      .where(eq(t.recommendations.runId, run.id))
      .orderBy(desc(t.reviewActions.createdAt)),
    db
      .select({
        recommendationId: t.purchaseOrders.recommendationId,
        status: t.purchaseOrders.status,
        number: t.purchaseOrders.zohoPoNumber,
        error: t.purchaseOrders.error,
        qty: t.purchaseOrders.qty,
      })
      .from(t.purchaseOrders)
      .innerJoin(t.recommendations, eq(t.recommendations.id, t.purchaseOrders.recommendationId))
      .where(eq(t.recommendations.runId, run.id)),
  ]);
  const purchaseOrders: Record<string, PurchaseOrderInfo> = Object.fromEntries(orders.map((o) => [o.recommendationId, o]));
  const history: Record<string, { id: string; action: string; reviewer: string; priorStatus: string; newStatus: string; priorQty: number | null; newQty: number | null; note: string | null; createdAt: string }[]> = {};
  for (const a of actions) {
    (history[a.recommendationId] ??= []).push({ ...a, createdAt: a.createdAt.toISOString() });
  }
  return { run, rows, history, purchaseOrders };
}

/** Distinct values for the workbench filters. */
export function distinctOf<T>(rows: T[], pick: (row: T) => string): string[] {
  return [...new Set(rows.map(pick))].sort();
}
