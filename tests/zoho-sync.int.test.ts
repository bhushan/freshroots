import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import * as t from "@/db/schema";
import type { Store } from "@/db/store";
import { loadSampleData, type SampleFile } from "@/lib/import/commit";
import { syncItemsFromZoho } from "@/lib/zoho/sync";
import type { ZohoClient, ZohoItem } from "@/lib/zoho/client";
import { createTestStore, sample } from "./helpers/db";

let store: Store;

beforeEach(async () => {
  store = await createTestStore();
  const files: SampleFile[] = [
    { dataset: "distributors", name: "d", text: sample("distributor_master.csv") },
    { dataset: "calendar", name: "c", text: sample("calendar.csv") },
    { dataset: "skus", name: "s", text: sample("sku_master.csv") },
  ];
  await loadSampleData(store, files);
});

const item = (over: Partial<ZohoItem> & { itemId: string; sku: string }): ZohoItem => ({ name: over.sku, unit: "pcs", active: true, customFields: {}, ...over });

function fakeZoho(list: ZohoItem[], details: Record<string, ZohoItem> = {}, vendors: Record<string, string> = { "NutriFlow Distributors": "V1", "GrainPath Logistics": "V2" }) {
  const calls = { getItem: [] as string[] };
  const client: ZohoClient = {
    async listItems() {
      return list;
    },
    async getItem(id) {
      calls.getItem.push(id);
      return details[id] ?? null;
    },
    async findVendorId(name) {
      return vendors[name] ?? null;
    },
    async findItemId() {
      return null;
    },
    async findPurchaseOrderByReference() {
      return null;
    },
    async createPurchaseOrder() {
      throw new Error("not used");
    },
  };
  return { client, calls };
}

const sku = async (id: string) => (await store.db.select().from(t.skus).where(eq(t.skus.skuId, id)))[0];

describe("syncItemsFromZoho", () => {
  it("links existing SKUs to their Zoho item and takes the new name, leaving planning fields alone", async () => {
    const before = await sku("SKU001");
    const zoho = fakeZoho([item({ itemId: "I1", sku: "SKU001", name: "Freshroots Mango Drink 250ml" })]);
    const res = await syncItemsFromZoho(store, zoho.client);
    expect(res).toMatchObject({ ok: true, linked: 1, created: 0 });
    const after = await sku("SKU001");
    expect(after).toMatchObject({ zohoItemId: "I1", name: "Freshroots Mango Drink 250ml" });
    expect(after).toMatchObject({
      standardReorderQty: before.standardReorderQty,
      perishability: before.perishability,
      distributorId: before.distributorId,
      unitOfMeasure: before.unitOfMeasure,
    });
    expect(zoho.calls.getItem).toEqual([]); // no detail call for a SKU we already know
  });

  it("creates a SKU for a new Zoho item using its vendor, reorder level and custom fields", async () => {
    const zoho = fakeZoho([item({ itemId: "I99", sku: "SKU099", name: "Freshroots Granola 300g", unit: "Units" })], {
      I99: item({ itemId: "I99", sku: "SKU099", name: "Freshroots Granola 300g", unit: "Units", vendorId: "V2", reorderLevel: 240, customFields: { perishability: "High", category: "Snack" } }),
    });
    const res = await syncItemsFromZoho(store, zoho.client);
    expect(res).toMatchObject({ ok: true, created: 1 });
    expect(await sku("SKU099")).toMatchObject({
      name: "Freshroots Granola 300g",
      distributorId: "DIST002",
      standardReorderQty: 240,
      perishability: "High",
      category: "Snack",
      unitOfMeasure: "Units",
      zohoItemId: "I99",
    });
  });

  it("defaults perishability to Low and says so, instead of guessing silently", async () => {
    const zoho = fakeZoho([item({ itemId: "I98", sku: "SKU098" })], { I98: item({ itemId: "I98", sku: "SKU098", vendorId: "V1", reorderLevel: 100 }) });
    const res = await syncItemsFromZoho(store, zoho.client);
    expect(await sku("SKU098")).toMatchObject({ perishability: "Low", category: "Uncategorised" });
    expect(res.ok && res.defaulted).toEqual([{ sku: "SKU098", fields: ["perishability", "category"] }]);
  });

  it("skips, with a reason, an item whose vendor is not one of our distributors", async () => {
    const zoho = fakeZoho([item({ itemId: "I97", sku: "SKU097" })], { I97: item({ itemId: "I97", sku: "SKU097", vendorId: "V-UNKNOWN", reorderLevel: 100 }) });
    const res = await syncItemsFromZoho(store, zoho.client);
    expect(res).toMatchObject({ ok: true, created: 0 });
    expect(res.ok && res.skipped).toEqual([{ sku: "SKU097", reason: expect.stringContaining("vendor") }]);
    expect(await sku("SKU097")).toBeUndefined();
  });

  it("skips an item with no usable reorder level", async () => {
    const zoho = fakeZoho([item({ itemId: "I96", sku: "SKU096" })], { I96: item({ itemId: "I96", sku: "SKU096", vendorId: "V1" }) });
    const res = await syncItemsFromZoho(store, zoho.client);
    expect(res.ok && res.skipped).toEqual([{ sku: "SKU096", reason: expect.stringContaining("reorder level") }]);
  });

  it("ignores inactive items and items without a SKU code", async () => {
    const zoho = fakeZoho([item({ itemId: "I1", sku: "SKU001", active: false }), item({ itemId: "I2", sku: "" })]);
    const res = await syncItemsFromZoho(store, zoho.client);
    expect(res).toMatchObject({ ok: true, linked: 0, created: 0, ignored: 2 });
    expect((await sku("SKU001")).zohoItemId).toBeNull();
  });

  it("is idempotent: syncing twice changes nothing the second time", async () => {
    const list = [item({ itemId: "I99", sku: "SKU099" })];
    const details = { I99: item({ itemId: "I99", sku: "SKU099", vendorId: "V2", reorderLevel: 240 }) };
    await syncItemsFromZoho(store, fakeZoho(list, details).client);
    const second = await syncItemsFromZoho(store, fakeZoho(list, details).client);
    expect(second).toMatchObject({ ok: true, created: 0, linked: 0 });
    expect(await store.db.select().from(t.skus)).toHaveLength(16);
  });

  it("returns a readable failure when Zoho cannot be read", async () => {
    const zoho = fakeZoho([]);
    zoho.client.listItems = async () => {
      throw new Error("boom");
    };
    expect(await syncItemsFromZoho(store, zoho.client)).toMatchObject({ ok: false, message: expect.any(String) });
  });
});
