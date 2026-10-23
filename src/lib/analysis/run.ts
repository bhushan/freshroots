import { desc, eq } from "drizzle-orm";
import * as t from "@/db/schema";
import type { Db, Store } from "@/db/store";
import { RULES } from "@/lib/rules/config";
import { analyzeSku, type ActionCode, type SkuAnalysis } from "@/lib/rules/engine";

export interface RunSummary {
  totalSkus: number;
  highDemand: number;
  stockoutRisk: number;
  overstockRisk: number;
  manualReview: number;
  insufficientData: number;
  actionCounts: Partial<Record<ActionCode, number>>;
  warnings: string[];
}

export type RunResult =
  | { ok: true; runId: string; summary: RunSummary }
  | { ok: false; code: "NO_DATA"; message: string };

export async function getLatestRun(db: Db) {
  const [run] = await db.select().from(t.analysisRuns).orderBy(desc(t.analysisRuns.createdAt)).limit(1);
  return run ?? null;
}

function summarize(analyses: SkuAnalysis[], warnings: string[]): RunSummary {
  const has = (a: SkuAnalysis, code: string) => a.flags.some((f) => f.code === code);
  const actionCounts: RunSummary["actionCounts"] = {};
  for (const a of analyses) actionCounts[a.action] = (actionCounts[a.action] ?? 0) + 1;
  return {
    totalSkus: analyses.length,
    highDemand: analyses.filter((a) => has(a, "HIGH_DEMAND")).length,
    stockoutRisk: analyses.filter((a) => has(a, "STOCKOUT_RISK")).length,
    overstockRisk: analyses.filter((a) => has(a, "OVERSTOCK_RISK")).length,
    manualReview: analyses.filter((a) => a.requiresManualReview).length,
    insufficientData: analyses.filter((a) => has(a, "INSUFFICIENT_DATA")).length,
    actionCounts,
    warnings,
  };
}

/**
 * Computes recommendations from the latest inventory snapshot and stores them as a new run.
 * Pure rule evaluation happens in the engine; this function only loads inputs and persists outputs.
 */
export async function runAnalysis(store: Store): Promise<RunResult> {
  const { db } = store;

  const [snapshot] = await db
    .select()
    .from(t.inventorySnapshots)
    .orderBy(desc(t.inventorySnapshots.asOfDate), desc(t.inventorySnapshots.id))
    .limit(1);
  const skuRows = await db.select().from(t.skus).orderBy(t.skus.skuId);
  if (!snapshot || skuRows.length === 0) {
    return { ok: false, code: "NO_DATA", message: "Load SKU master and inventory data before running an analysis." };
  }

  const [salesRows, itemRows, calendarRows] = await Promise.all([
    db.select().from(t.weeklySales),
    db.select().from(t.inventoryItems).where(eq(t.inventoryItems.snapshotId, snapshot.id)),
    db.select().from(t.calendarMonths).where(eq(t.calendarMonths.yearMonth, snapshot.asOfDate.slice(0, 7))),
  ]);

  const warnings: string[] = [];
  const analysisMonth = snapshot.asOfDate.slice(0, 7);
  let festivalMonth: boolean;
  if (calendarRows[0]) {
    festivalMonth = calendarRows[0].isFestivalMonth;
  } else {
    festivalMonth = (RULES.festivalMonths as readonly number[]).includes(Number(analysisMonth.slice(5)));
    warnings.push(`No calendar row for ${analysisMonth}; used the documented festival months (Mar, Oct, Nov) instead.`);
  }

  const salesBySku = new Map<string, { isoYear: number; isoWeek: number; units: number }[]>();
  for (const s of salesRows) {
    const list = salesBySku.get(s.skuId) ?? [];
    list.push({ isoYear: s.isoYear, isoWeek: s.isoWeek, units: s.unitsSold });
    salesBySku.set(s.skuId, list);
  }
  const stockBySku = new Map(itemRows.map((i) => [i.skuId, i.unitsOnHand]));

  const analyses = skuRows.map((sku) =>
    analyzeSku({
      sku: {
        skuId: sku.skuId,
        name: sku.name,
        category: sku.category,
        perishability: sku.perishability as "Low" | "High",
        standardReorderQty: sku.standardReorderQty,
      },
      sales: salesBySku.get(sku.skuId) ?? [],
      unitsOnHand: stockBySku.get(sku.skuId) ?? null,
      festivalMonth,
    }),
  );
  const summary = summarize(analyses, warnings);

  const runId = await store.tx(async (tx) => {
    const [run] = await tx
      .insert(t.analysisRuns)
      .values({
        analysisMonth,
        festivalMonth,
        snapshotId: snapshot.id,
        snapshotDate: snapshot.asOfDate,
        configSnapshot: { ...RULES },
        summary,
      })
      .returning({ id: t.analysisRuns.id });

    await tx.insert(t.recommendations).values(
      analyses.map((a) => ({
        runId: run.id,
        skuId: a.skuId,
        distinctWeeks: a.distinctWeeks,
        latestWeek: a.latestWeek,
        avg4Raw: a.avg4Raw,
        avg12Raw: a.avg12Raw,
        avg4Adjusted: a.avg4Adjusted,
        avg12Adjusted: a.avg12Adjusted,
        festivalUpliftApplied: a.festivalUpliftApplied,
        unitsOnHand: a.unitsOnHand,
        coverageWeeks: a.coverageWeeks,
        flags: a.flags,
        warnings: a.warnings,
        action: a.action,
        suggestedQty: a.suggestedQty,
        explanation: a.explanation,
      })),
    );
    return run.id;
  });

  return { ok: true, runId, summary };
}
