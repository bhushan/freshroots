import { count, eq } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it } from "vitest";
import * as t from "@/db/schema";
import type { Store } from "@/db/store";
import { dedupeFilesByContent, importDataset, loadSampleData, type SampleFile } from "@/lib/import/commit";
import { createTestStore, sample } from "./helpers/db";

let store: Store;
beforeEach(async () => {
  store = await createTestStore();
});

const rows = async (table: PgTable) => (await store.db.select({ n: count() }).from(table))[0].n;

async function loadMasters() {
  await importDataset(store, "distributors", sample("distributor_master.csv"));
  await importDataset(store, "skus", sample("sku_master.csv"));
}

describe("importing the supplied sample data", () => {
  it("loads every dataset with the expected row counts", async () => {
    const results = await loadSampleData(store, sampleFiles());
    expect(results.every((r) => r.status === "imported" || r.status === "skipped-duplicate-file")).toBe(true);
    expect(await rows(t.distributors)).toBe(4);
    expect(await rows(t.skus)).toBe(15);
    expect(await rows(t.weeklySales)).toBe(240);
    expect(await rows(t.inventorySnapshots)).toBe(1);
    expect(await rows(t.inventoryItems)).toBe(15);
    expect(await rows(t.calendarMonths)).toBe(24);
  });

  it("is idempotent: importing twice does not double-count", async () => {
    await loadSampleData(store, sampleFiles());
    await loadSampleData(store, sampleFiles());
    expect(await rows(t.weeklySales)).toBe(240);
    expect(await rows(t.skus)).toBe(15);
    expect(await rows(t.inventoryItems)).toBe(15);
    const sales = await store.db.select().from(t.weeklySales);
    expect(sales.reduce((sum, r) => sum + r.unitsSold, 0)).toBe(sampleUnitTotal());
  });

  it("imports the two identical distributor files only once", async () => {
    const files: SampleFile[] = [
      { dataset: "distributors", name: "distributor_master.csv", text: sample("distributor_master.csv") },
      { dataset: "distributors", name: "distributor_master (1).csv", text: sample("distributor_master (1).csv") },
    ];
    const { unique, skipped } = dedupeFilesByContent(files);
    expect(unique.map((f) => f.name)).toEqual(["distributor_master.csv"]);
    expect(skipped.map((f) => f.name)).toEqual(["distributor_master (1).csv"]);
    const results = await loadSampleData(store, files);
    expect(results.map((r) => r.status)).toEqual(["imported", "skipped-duplicate-file"]);
    expect(await rows(t.distributors)).toBe(4);
    const batches = await store.db.select().from(t.importBatches).where(eq(t.importBatches.dataset, "distributors"));
    expect(batches).toHaveLength(1);
  });

  it("records the latest date and import time per dataset", async () => {
    await loadSampleData(store, sampleFiles());
    const batches = await store.db.select().from(t.importBatches);
    const byDataset = Object.fromEntries(batches.map((b) => [b.dataset, b]));
    expect(byDataset.weekly_sales.latestDate).toBe("2026-W42");
    expect(byDataset.inventory.latestDate).toBe("2026-10-19");
    expect(byDataset.weekly_sales.importedAt).toBeInstanceOf(Date);
  });
});

describe("failed imports never replace good data", () => {
  it("rejects the whole file when any row is invalid and leaves existing rows untouched", async () => {
    await loadMasters();
    await importDataset(store, "weekly_sales", sample("weekly_sales.csv"));
    const before = await store.db.select().from(t.weeklySales);

    const bad = "SKU_ID,Week,Units_Sold\nSKU001,2026-W27,9999\nSKU001,2026-W28,-5\n";
    const result = await importDataset(store, "weekly_sales", bad);

    expect(result.status).toBe("rejected");
    expect(result.report.ok).toBe(false);
    expect(await rows(t.weeklySales)).toBe(240);
    expect(await store.db.select().from(t.weeklySales)).toEqual(before);
  });

  it("rejects sales for SKUs that were never imported", async () => {
    const result = await importDataset(store, "weekly_sales", sample("weekly_sales.csv"));
    expect(result.status).toBe("rejected");
    expect(await rows(t.weeklySales)).toBe(0);
  });

  it("rolls back the whole transaction if the database rejects part of the load", async () => {
    await loadMasters();
    const original = store.tx;
    store = {
      db: store.db,
      tx: (fn) =>
        original(async (tx) => {
          const wrapped = new Proxy(tx, {
            get(target, prop, receiver) {
              if (prop === "insert") {
                return (table: unknown) => {
                  if (table === t.importBatches) throw new Error("simulated failure after data was written");
                  return target.insert(table as never);
                };
              }
              return Reflect.get(target, prop, receiver);
            },
          });
          return fn(wrapped);
        }),
    };
    await expect(importDataset(store, "weekly_sales", sample("weekly_sales.csv"))).rejects.toThrow(/simulated/);
    expect(await rows(t.weeklySales)).toBe(0);
  });
});

describe("schema constraints", () => {
  it("rejects duplicate SKU/week rows and negative values at the database level", async () => {
    await loadMasters();
    const row = { skuId: "SKU001", isoYear: 2026, isoWeek: 1, unitsSold: 5 };
    await store.db.insert(t.weeklySales).values(row);
    await expect(store.db.insert(t.weeklySales).values(row)).rejects.toThrow();
    await expect(store.db.insert(t.weeklySales).values({ ...row, isoWeek: 2, unitsSold: -1 })).rejects.toThrow();
  });
});

function sampleUnitTotal(): number {
  return sample("weekly_sales.csv")
    .trim()
    .split("\n")
    .slice(1)
    .reduce((sum, line) => sum + Number(line.split(",")[2]), 0);
}

function sampleFiles(): SampleFile[] {
  return [
    { dataset: "distributors", name: "distributor_master.csv", text: sample("distributor_master.csv") },
    { dataset: "distributors", name: "distributor_master (1).csv", text: sample("distributor_master (1).csv") },
    { dataset: "calendar", name: "calendar.csv", text: sample("calendar.csv") },
    { dataset: "skus", name: "sku_master.csv", text: sample("sku_master.csv") },
    { dataset: "weekly_sales", name: "weekly_sales.csv", text: sample("weekly_sales.csv") },
    { dataset: "inventory", name: "current_inventory.csv", text: sample("current_inventory.csv") },
  ];
}
