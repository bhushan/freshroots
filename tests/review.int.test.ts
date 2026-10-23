import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import * as t from "@/db/schema";
import type { Store } from "@/db/store";
import { runAnalysis } from "@/lib/analysis/run";
import { loadSampleData, type SampleFile } from "@/lib/import/commit";
import { approvedForExport, listReviewQueue, reviewRecommendation } from "@/lib/review/service";
import { createTestStore, sample } from "./helpers/db";

let store: Store;
let runId: string;
let ids: Record<string, string>;

beforeEach(async () => {
  store = await createTestStore();
  const files: SampleFile[] = [
    { dataset: "distributors", name: "d", text: sample("distributor_master.csv") },
    { dataset: "calendar", name: "c", text: sample("calendar.csv") },
    { dataset: "skus", name: "s", text: sample("sku_master.csv") },
    { dataset: "weekly_sales", name: "w", text: sample("weekly_sales.csv") },
    { dataset: "inventory", name: "i", text: sample("current_inventory.csv") },
  ];
  await loadSampleData(store, files);
  const run = await runAnalysis(store);
  if (!run.ok) throw new Error(run.message);
  runId = run.runId;
  const recs = await store.db.select().from(t.recommendations).where(eq(t.recommendations.runId, runId));
  ids = Object.fromEntries(recs.map((r) => [r.skuId, r.id]));
});

describe("reviewRecommendation", () => {
  it("approves and writes an audit row with prior and new state", async () => {
    const res = await reviewRecommendation(store, { recommendationId: ids.SKU001, type: "approve", reviewer: "Raghav", note: "ok" });
    expect(res).toMatchObject({ ok: true });

    const [rec] = await store.db.select().from(t.recommendations).where(eq(t.recommendations.id, ids.SKU001));
    expect(rec).toMatchObject({ reviewStatus: "approved", finalQty: 750 });
    expect(rec.reviewedAt).toBeInstanceOf(Date);

    const audit = await store.db.select().from(t.reviewActions).where(eq(t.reviewActions.recommendationId, ids.SKU001));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "approve",
      reviewer: "Raghav",
      priorStatus: "pending",
      newStatus: "approved",
      priorQty: 750,
      newQty: 750,
      note: "ok",
    });
    expect(audit[0].createdAt).toBeInstanceOf(Date);
  });

  it("records an override with the planner quantity", async () => {
    await reviewRecommendation(store, { recommendationId: ids.SKU003, type: "override", overrideQty: 450, reviewer: "Raghav", note: "festival buffer" });
    const [rec] = await store.db.select().from(t.recommendations).where(eq(t.recommendations.id, ids.SKU003));
    expect(rec).toMatchObject({ reviewStatus: "overridden", finalQty: 450, suggestedQty: 300 });
  });

  it("leaves the computed suggestion untouched by any human action", async () => {
    await reviewRecommendation(store, { recommendationId: ids.SKU003, type: "reject", reviewer: "Raghav" });
    const [rec] = await store.db.select().from(t.recommendations).where(eq(t.recommendations.id, ids.SKU003));
    expect(rec).toMatchObject({ suggestedQty: 300, action: "REORDER_IMMEDIATE", reviewStatus: "rejected", finalQty: null });
  });

  it("rejects an invalid transition without writing anything", async () => {
    await reviewRecommendation(store, { recommendationId: ids.SKU001, type: "approve", reviewer: "Raghav" });
    const again = await reviewRecommendation(store, { recommendationId: ids.SKU001, type: "reject", reviewer: "Raghav" });
    expect(again).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    expect(await store.db.select().from(t.reviewActions)).toHaveLength(1);
  });

  it("returns NOT_FOUND for an unknown id", async () => {
    const res = await reviewRecommendation(store, { recommendationId: "00000000-0000-4000-8000-000000000000", type: "approve", reviewer: "x" });
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("refuses decisions on a superseded run", async () => {
    const second = await runAnalysis(store);
    if (!second.ok) throw new Error("run failed");
    const res = await reviewRecommendation(store, { recommendationId: ids.SKU001, type: "approve", reviewer: "Raghav" });
    expect(res).toMatchObject({ ok: false, code: "STALE_RUN" });
  });

  it("does not leave a half-written decision if the audit insert fails", async () => {
    const original = store.tx;
    const failing: Store = {
      db: store.db,
      tx: (fn) =>
        original((tx) =>
          fn(
            new Proxy(tx, {
              get(target, prop, receiver) {
                if (prop === "insert") {
                  return (table: unknown) => {
                    if (table === t.reviewActions) throw new Error("audit write failed");
                    return target.insert(table as never);
                  };
                }
                return Reflect.get(target, prop, receiver);
              },
            }),
          ),
        ),
    };
    await expect(reviewRecommendation(failing, { recommendationId: ids.SKU001, type: "approve", reviewer: "Raghav" })).rejects.toThrow(/audit/);
    const [rec] = await store.db.select().from(t.recommendations).where(eq(t.recommendations.id, ids.SKU001));
    expect(rec.reviewStatus).toBe("pending");
  });
});

describe("queue and export", () => {
  it("groups the latest run's recommendations by review status", async () => {
    await reviewRecommendation(store, { recommendationId: ids.SKU001, type: "approve", reviewer: "R" });
    await reviewRecommendation(store, { recommendationId: ids.SKU003, type: "override", overrideQty: 10, reviewer: "R" });
    await reviewRecommendation(store, { recommendationId: ids.SKU004, type: "reject", reviewer: "R" });
    await reviewRecommendation(store, { recommendationId: ids.SKU011, type: "investigate", reviewer: "R" });
    const queue = await listReviewQueue(store.db);
    const count = (s: string) => queue.items.filter((i) => i.reviewStatus === s).length;
    expect(count("approved")).toBe(1);
    expect(count("overridden")).toBe(1);
    expect(count("rejected")).toBe(1);
    expect(count("investigating")).toBe(1);
    expect(count("pending")).toBe(11);
  });

  it("leaves Maintain and Monitor items out of the procurement export, since they propose no order", async () => {
    await reviewRecommendation(store, { recommendationId: ids.SKU002, type: "approve", reviewer: "R" });
    await reviewRecommendation(store, { recommendationId: ids.SKU006, type: "approve", reviewer: "R" });
    const rows = await approvedForExport(store.db);
    expect(rows.map((r) => r.skuId)).toEqual(["SKU006"]); // a Pause is exported (quantity 0), a Maintain is not
  });

  it("exports only approved and overridden items, using the final quantity", async () => {
    await reviewRecommendation(store, { recommendationId: ids.SKU001, type: "approve", reviewer: "R" });
    await reviewRecommendation(store, { recommendationId: ids.SKU003, type: "override", overrideQty: 450, reviewer: "R", note: "buffer" });
    await reviewRecommendation(store, { recommendationId: ids.SKU004, type: "reject", reviewer: "R" });
    const rows = await approvedForExport(store.db);
    expect(rows.map((r) => [r.skuId, r.finalQty, r.reviewStatus])).toEqual([
      ["SKU001", 750, "approved"],
      ["SKU003", 450, "overridden"],
    ]);
  });
});
