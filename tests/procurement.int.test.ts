import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import * as t from "@/db/schema";
import type { Store } from "@/db/store";
import { runAnalysis } from "@/lib/analysis/run";
import { loadSampleData, type SampleFile } from "@/lib/import/commit";
import { sendPurchaseOrder } from "@/lib/procurement/service";
import { reviewRecommendation } from "@/lib/review/service";
import { ZohoError, type ZohoClient } from "@/lib/zoho/client";
import { createTestStore, sample } from "./helpers/db";

let store: Store;
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
  const recs = await store.db.select().from(t.recommendations).where(eq(t.recommendations.runId, run.runId));
  ids = Object.fromEntries(recs.map((r) => [r.skuId, r.id]));
});

/** In-memory Zoho: records every call and can be told to fail. */
function fakeZoho(opts: { vendors?: Record<string, string>; items?: Record<string, string>; existing?: Record<string, { id: string; number: string }>; failCreate?: string } = {}) {
  const log = { vendorLookups: [] as string[], itemLookups: [] as string[], creates: [] as Parameters<ZohoClient["createPurchaseOrder"]>[0][] };
  const vendors = opts.vendors ?? { "NutriFlow Distributors": "V1", "GrainPath Logistics": "V2", "PeakSource Supply": "V3", "Meridian Trade Co.": "V4" };
  const items = opts.items ?? new Proxy({}, { get: (_, sku: string) => `I-${sku}` });
  const client: ZohoClient = {
    async listItems() {
      return [];
    },
    async getItem() {
      return null;
    },
    async findVendorId(name) {
      log.vendorLookups.push(name);
      return vendors[name] ?? null;
    },
    async findItemId(sku) {
      log.itemLookups.push(sku);
      return (items as Record<string, string>)[sku] ?? null;
    },
    async findPurchaseOrderByReference(ref) {
      return opts.existing?.[ref] ?? null;
    },
    async createPurchaseOrder(input) {
      if (opts.failCreate) throw new ZohoError("API", opts.failCreate);
      log.creates.push(input);
      return { id: `PO-${log.creates.length}`, number: `PO-0000${log.creates.length}` };
    },
  };
  return { client, log };
}

const poFor = async (sku: string) => (await store.db.select().from(t.purchaseOrders).where(eq(t.purchaseOrders.recommendationId, ids[sku])))[0];

describe("queuing a purchase order on review", () => {
  it("queues one pending order with the approved quantity", async () => {
    await reviewRecommendation(store, { recommendationId: ids.SKU001, type: "approve", reviewer: "Raghav" });
    expect(await poFor("SKU001")).toMatchObject({ status: "pending", qty: 750, zohoPoId: null, attempts: 0 });
  });

  it("uses the planner's quantity for an override", async () => {
    await reviewRecommendation(store, { recommendationId: ids.SKU003, type: "override", overrideQty: 450, reviewer: "R" });
    expect(await poFor("SKU003")).toMatchObject({ qty: 450 });
  });

  it("queues nothing for reject, investigate, Maintain, or a Pause with quantity 0", async () => {
    await reviewRecommendation(store, { recommendationId: ids.SKU004, type: "reject", reviewer: "R" });
    await reviewRecommendation(store, { recommendationId: ids.SKU011, type: "investigate", reviewer: "R" });
    await reviewRecommendation(store, { recommendationId: ids.SKU002, type: "approve", reviewer: "R" }); // Maintain
    await reviewRecommendation(store, { recommendationId: ids.SKU006, type: "approve", reviewer: "R" }); // Pause, qty 0
    expect(await store.db.select().from(t.purchaseOrders)).toHaveLength(0);
  });

  it("gives each order a reference that is unique to its recommendation", async () => {
    await reviewRecommendation(store, { recommendationId: ids.SKU001, type: "approve", reviewer: "R" });
    await reviewRecommendation(store, { recommendationId: ids.SKU003, type: "approve", reviewer: "R" });
    const [a, b] = await Promise.all([poFor("SKU001"), poFor("SKU003")]);
    expect(a.reference).not.toBe(b.reference);
    expect(a.reference).toContain("SKU001");
  });
});

describe("sendPurchaseOrder", () => {
  beforeEach(async () => {
    await reviewRecommendation(store, { recommendationId: ids.SKU001, type: "approve", reviewer: "Raghav", note: "urgent" });
  });

  it("creates the order in Zoho for the right vendor, item and quantity", async () => {
    const zoho = fakeZoho();
    const res = await sendPurchaseOrder(store, ids.SKU001, { zoho: zoho.client, today: "2026-10-23" });
    expect(res).toMatchObject({ ok: true, status: "created", number: "PO-00001" });
    expect(zoho.log.vendorLookups).toEqual(["NutriFlow Distributors"]);
    expect(zoho.log.creates).toEqual([
      expect.objectContaining({ vendorId: "V1", itemId: "I-SKU001", quantity: 750, date: "2026-10-23", reference: (await poFor("SKU001")).reference }),
    ]);
    expect(zoho.log.creates[0].notes).toContain("Raghav");
    expect(await poFor("SKU001")).toMatchObject({ status: "created", zohoPoId: "PO-1", zohoPoNumber: "PO-00001", error: null, attempts: 1 });
  });

  it("caches the resolved Zoho ids so the next order skips the lookups", async () => {
    await sendPurchaseOrder(store, ids.SKU001, { zoho: fakeZoho().client, today: "2026-10-23" });
    const [dist] = await store.db.select().from(t.distributors).where(eq(t.distributors.distributorId, "DIST001"));
    const [sku] = await store.db.select().from(t.skus).where(eq(t.skus.skuId, "SKU001"));
    expect(dist.zohoVendorId).toBe("V1");
    expect(sku.zohoItemId).toBe("I-SKU001");

    await reviewRecommendation(store, { recommendationId: ids.SKU003, type: "approve", reviewer: "R" }); // DIST002
    await reviewRecommendation(store, { recommendationId: ids.SKU005, type: "override", overrideQty: 5, reviewer: "R" });
    const again = fakeZoho();
    await sendPurchaseOrder(store, ids.SKU001, { zoho: again.client, today: "2026-10-23" });
    expect(again.log.vendorLookups).toEqual([]);
  });

  it("never creates a second order for the same recommendation", async () => {
    const zoho = fakeZoho();
    await sendPurchaseOrder(store, ids.SKU001, { zoho: zoho.client, today: "2026-10-23" });
    const again = await sendPurchaseOrder(store, ids.SKU001, { zoho: zoho.client, today: "2026-10-23" });
    expect(again).toMatchObject({ ok: true, status: "created", number: "PO-00001" });
    expect(zoho.log.creates).toHaveLength(1);
  });

  it("adopts an order Zoho already holds under the reference instead of duplicating it", async () => {
    const reference = (await poFor("SKU001")).reference;
    const zoho = fakeZoho({ existing: { [reference]: { id: "OLD", number: "PO-00007" } } });
    const res = await sendPurchaseOrder(store, ids.SKU001, { zoho: zoho.client, today: "2026-10-23" });
    expect(res).toMatchObject({ ok: true, status: "created", number: "PO-00007" });
    expect(zoho.log.creates).toHaveLength(0);
  });

  it("keeps the approval and records a readable failure when the vendor is missing in Zoho", async () => {
    const res = await sendPurchaseOrder(store, ids.SKU001, { zoho: fakeZoho({ vendors: {} }).client, today: "2026-10-23" });
    expect(res).toMatchObject({ ok: false, code: "VENDOR_NOT_FOUND" });
    expect(res.ok ? "" : res.message).toContain("NutriFlow Distributors");
    expect(await poFor("SKU001")).toMatchObject({ status: "failed", attempts: 1, error: expect.stringContaining("NutriFlow Distributors") });
    const [rec] = await store.db.select().from(t.recommendations).where(eq(t.recommendations.id, ids.SKU001));
    expect(rec.reviewStatus).toBe("approved");
  });

  it("explains a missing item by its SKU", async () => {
    const res = await sendPurchaseOrder(store, ids.SKU001, { zoho: fakeZoho({ items: {} }).client, today: "2026-10-23" });
    expect(res).toMatchObject({ ok: false, code: "ITEM_NOT_FOUND" });
    expect(res.ok ? "" : res.message).toContain("SKU001");
  });

  it("records an API failure, then succeeds on retry without losing the attempt count", async () => {
    const failed = await sendPurchaseOrder(store, ids.SKU001, { zoho: fakeZoho({ failCreate: "Item rate is required." }).client, today: "2026-10-23" });
    expect(failed).toMatchObject({ ok: false, code: "ZOHO_ERROR" });
    expect(await poFor("SKU001")).toMatchObject({ status: "failed", error: "Item rate is required." });

    const retried = await sendPurchaseOrder(store, ids.SKU001, { zoho: fakeZoho().client, today: "2026-10-23" });
    expect(retried).toMatchObject({ ok: true, status: "created" });
    expect(await poFor("SKU001")).toMatchObject({ status: "created", attempts: 2, error: null });
  });

  it("does nothing and stays pending while Zoho is not configured", async () => {
    const res = await sendPurchaseOrder(store, ids.SKU001, { zoho: null, today: "2026-10-23" });
    expect(res).toMatchObject({ ok: false, code: "NOT_CONFIGURED" });
    expect(await poFor("SKU001")).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("creates only one order when two sends race", async () => {
    const zoho = fakeZoho();
    const [a, b] = await Promise.all([
      sendPurchaseOrder(store, ids.SKU001, { zoho: zoho.client, today: "2026-10-23" }),
      sendPurchaseOrder(store, ids.SKU001, { zoho: zoho.client, today: "2026-10-23" }),
    ]);
    expect(zoho.log.creates).toHaveLength(1);
    expect([a, b].filter((r) => r.ok)).toHaveLength(1);
    expect([a, b].find((r) => !r.ok)).toMatchObject({ code: "IN_PROGRESS" });
  });

  it("reports NOT_FOUND when the recommendation has no order", async () => {
    const res = await sendPurchaseOrder(store, ids.SKU004, { zoho: fakeZoho().client, today: "2026-10-23" });
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});
