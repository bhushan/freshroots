import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import * as t from "@/db/schema";
import type { Store } from "@/db/store";
import { getLatestRun, runAnalysis } from "@/lib/analysis/run";
import { loadSampleData, type SampleFile } from "@/lib/import/commit";
import { createTestStore, sample } from "./helpers/db";

let store: Store;
beforeEach(async () => {
  store = await createTestStore();
});

const files = (): SampleFile[] => [
  { dataset: "distributors", name: "distributor_master.csv", text: sample("distributor_master.csv") },
  { dataset: "calendar", name: "calendar.csv", text: sample("calendar.csv") },
  { dataset: "skus", name: "sku_master.csv", text: sample("sku_master.csv") },
  { dataset: "weekly_sales", name: "weekly_sales.csv", text: sample("weekly_sales.csv") },
  { dataset: "inventory", name: "current_inventory.csv", text: sample("current_inventory.csv") },
];

async function recsBySku(runId: string) {
  const rows = await store.db.select().from(t.recommendations).where(eq(t.recommendations.runId, runId));
  return Object.fromEntries(rows.map((r) => [r.skuId, r]));
}

describe("empty database", () => {
  it("reports that data must be loaded first and writes nothing", async () => {
    const result = await runAnalysis(store);
    expect(result).toMatchObject({ ok: false, code: "NO_DATA" });
    expect(await store.db.select().from(t.analysisRuns)).toHaveLength(0);
  });
});

describe("analysis of the supplied sample (golden values, computed independently)", () => {
  beforeEach(async () => {
    await loadSampleData(store, files());
  });

  it("uses the snapshot month as the analysis month and applies the festival uplift", async () => {
    const result = await runAnalysis(store);
    if (!result.ok) throw new Error(result.message);
    const run = await getLatestRun(store.db);
    expect(run).toMatchObject({ id: result.runId, analysisMonth: "2026-10", festivalMonth: true, snapshotDate: "2026-10-19" });
    expect(run?.configSnapshot).toMatchObject({ festivalUplift: 1.25 });
  });

  it("produces the expected flags, actions and quantities", async () => {
    const result = await runAnalysis(store);
    if (!result.ok) throw new Error(result.message);
    const recs = await recsBySku(result.runId);

    expect(Object.keys(recs)).toHaveLength(15);
    expect(recs.SKU001.avg12Raw).toBeCloseTo(214.92, 2);
    expect(recs.SKU001.avg12Adjusted).toBeCloseTo(268.65, 2);
    expect(recs.SKU001.coverageWeeks).toBeCloseTo(3.35, 2);
    expect(recs.SKU001.flags.map((f) => f.code).sort()).toEqual(["HIGH_DEMAND", "STOCKOUT_RISK"]);
    expect(recs.SKU001).toMatchObject({ action: "REORDER_HIGH_DEMAND", suggestedQty: 750, reviewStatus: "pending" });

    for (const [sku, qty] of [["SKU003", 300], ["SKU004", 150], ["SKU011", 500], ["SKU013", 120]] as const) {
      expect(recs[sku], sku).toMatchObject({ action: "REORDER_IMMEDIATE", suggestedQty: qty });
    }
    for (const sku of ["SKU006", "SKU007"]) {
      expect(recs[sku], sku).toMatchObject({ action: "PAUSE_NEXT_ORDER", suggestedQty: 0 });
    }
    for (const sku of ["SKU002", "SKU005", "SKU008", "SKU009", "SKU010", "SKU012", "SKU014", "SKU015"]) {
      expect(recs[sku].action, sku).toBe("MAINTAIN_MONITOR");
    }
  });

  it("summarises counts without inventing financial impact", async () => {
    const result = await runAnalysis(store);
    if (!result.ok) throw new Error(result.message);
    expect(result.summary).toMatchObject({
      totalSkus: 15,
      highDemand: 1,
      stockoutRisk: 5,
      overstockRisk: 2,
      manualReview: 0,
      insufficientData: 0,
    });
    expect(result.summary).not.toHaveProperty("savings");
  });

  it("keeps earlier runs and decisions when the analysis is re-run", async () => {
    const first = await runAnalysis(store);
    const second = await runAnalysis(store);
    if (!first.ok || !second.ok) throw new Error("run failed");
    expect(second.runId).not.toBe(first.runId);
    expect(await store.db.select().from(t.analysisRuns)).toHaveLength(2);
    expect(await store.db.select().from(t.recommendations)).toHaveLength(30);
    expect((await getLatestRun(store.db))?.id).toBe(second.runId);
  });

  it("falls back to the documented festival months, with a warning, if the calendar row is missing", async () => {
    await store.db.delete(t.calendarMonths).where(eq(t.calendarMonths.yearMonth, "2026-10"));
    const result = await runAnalysis(store);
    if (!result.ok) throw new Error(result.message);
    expect(result.summary.warnings.join(" ")).toMatch(/calendar/i);
    const run = await getLatestRun(store.db);
    expect(run?.festivalMonth).toBe(true);
  });

  it("flags insufficient data for a SKU with fewer than twelve observed weeks", async () => {
    const rows = await store.db.select().from(t.weeklySales).where(eq(t.weeklySales.skuId, "SKU015"));
    for (const r of rows.slice(0, 6)) await store.db.delete(t.weeklySales).where(eq(t.weeklySales.id, r.id));
    const result = await runAnalysis(store);
    if (!result.ok) throw new Error(result.message);
    const recs = await recsBySku(result.runId);
    expect(recs.SKU015).toMatchObject({ action: "MANUAL_REVIEW_INSUFFICIENT_DATA", suggestedQty: null, avg12Raw: null });
    expect(result.summary).toMatchObject({ insufficientData: 1, manualReview: 1 });
  });

  it("never calls Gemini", async () => {
    // The analysis module must not depend on the AI module at all.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/lib/analysis/run.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/@google\/genai|lib\/ai/);
  });
});
