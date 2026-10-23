import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as t from "@/db/schema";
import type { Store } from "@/db/store";
import { purchaseOrderHandler, reviewHandler, secretSyncHandler, zohoSyncHandler } from "@/lib/api/handlers";
import { createSessionToken, type AuthEnv } from "@/lib/auth/session";
import { runAnalysis } from "@/lib/analysis/run";
import { loadSampleData, type SampleFile } from "@/lib/import/commit";
import { ZohoError, type ZohoClient } from "@/lib/zoho/client";
import { createTestStore, sample } from "./helpers/db";

const SECRET = "s".repeat(40);
const env: AuthEnv = { ADMIN_PASSWORD: "pw-123", SESSION_SECRET: SECRET };
const token = createSessionToken(SECRET);

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

function zohoStub(over: Partial<ZohoClient> = {}): ZohoClient & { created: number } {
  const stub = {
    created: 0,
    async listItems() {
      return [];
    },
    async getItem() {
      return null;
    },
    async findVendorId() {
      return "V1";
    },
    async findItemId() {
      return "I1";
    },
    async findPurchaseOrderByReference() {
      return null;
    },
    async createPurchaseOrder() {
      stub.created += 1;
      return { id: "PO-1", number: "PO-00001" };
    },
    ...over,
  };
  return stub;
}

const review = (recId: string, rawBody: unknown, zoho: ZohoClient | null) => reviewHandler({ store, env, token, recId, rawBody, zoho });

describe("approving places the purchase order", () => {
  it("creates the Zoho order as part of an approval and reports it", async () => {
    const zoho = zohoStub();
    const res = await review(ids.SKU001, { type: "approve" }, zoho);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ purchaseOrder: { status: "created", number: "PO-00001" } });
    expect(zoho.created).toBe(1);
  });

  it("keeps the approval when Zoho fails and reports the failure so it can be retried", async () => {
    const zoho = zohoStub({
      async createPurchaseOrder() {
        throw new ZohoError("API", "Zoho is down");
      },
    });
    const res = await review(ids.SKU001, { type: "approve" }, zoho);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ recommendation: { reviewStatus: "approved" }, purchaseOrder: { status: "failed", message: "Zoho is down" } });
  });

  it("leaves the order pending, with a reason, when Zoho is not connected", async () => {
    const res = await review(ids.SKU001, { type: "approve" }, null);
    expect(res.body).toMatchObject({ purchaseOrder: { status: "pending", code: "NOT_CONFIGURED" } });
  });

  it("reports no order for a rejection", async () => {
    const zoho = zohoStub();
    const res = await review(ids.SKU004, { type: "reject" }, zoho);
    expect((res.body as { purchaseOrder?: unknown }).purchaseOrder).toBeUndefined();
    expect(zoho.created).toBe(0);
  });

  it("sends the overridden quantity", async () => {
    const createPurchaseOrder = vi.fn(async () => ({ id: "PO-2", number: "PO-00002" }));
    await review(ids.SKU003, { type: "override", overrideQty: 450 }, zohoStub({ createPurchaseOrder }));
    expect(createPurchaseOrder).toHaveBeenCalledWith(expect.objectContaining({ quantity: 450 }));
  });
});

describe("purchaseOrderHandler (retry)", () => {
  it("requires an admin session", async () => {
    const res = await purchaseOrderHandler({ store, env, token: undefined, recId: ids.SKU001, zoho: zohoStub() });
    expect(res.status).toBe(401);
  });

  it("rejects a malformed id", async () => {
    const res = await purchaseOrderHandler({ store, env, token, recId: "nope", zoho: zohoStub() });
    expect(res.status).toBe(400);
  });

  it("sends a failed order and returns 200", async () => {
    await review(ids.SKU001, { type: "approve" }, null);
    const res = await purchaseOrderHandler({ store, env, token, recId: ids.SKU001, zoho: zohoStub() });
    expect(res).toMatchObject({ status: 200, body: { purchaseOrder: { status: "created" } } });
  });

  it("maps a missing order to 404 and an unconfigured Zoho to 503", async () => {
    expect((await purchaseOrderHandler({ store, env, token, recId: ids.SKU004, zoho: zohoStub() })).status).toBe(404);
    await review(ids.SKU001, { type: "approve" }, null);
    expect((await purchaseOrderHandler({ store, env, token, recId: ids.SKU001, zoho: null })).status).toBe(503);
  });
});

describe("item sync entry points", () => {
  const items = [{ itemId: "I1", name: "Freshroots Mango Drink 250ml", sku: "SKU001", unit: "pcs", active: true }];

  it("lets an admin run the sync", async () => {
    const res = await zohoSyncHandler({ store, env, token, zoho: zohoStub({ listItems: async () => items }) });
    expect(res).toMatchObject({ status: 200, body: { linked: 1 } });
  });

  it("refuses the sync without a session or without Zoho", async () => {
    expect((await zohoSyncHandler({ store, env, token: undefined, zoho: zohoStub() })).status).toBe(401);
    expect((await zohoSyncHandler({ store, env, token, zoho: null })).status).toBe(503);
  });

  it("accepts a webhook call only with the shared secret, in constant time", async () => {
    const args = { store, zoho: zohoStub({ listItems: async () => items }), expected: "whsec-123456789012" };
    expect((await secretSyncHandler({ ...args, provided: undefined })).status).toBe(401);
    expect((await secretSyncHandler({ ...args, provided: "whsec-wrong" })).status).toBe(401);
    expect((await secretSyncHandler({ ...args, provided: "whsec-123456789012" })).status).toBe(200);
  });

  it("is switched off when no secret is configured, even if the caller sends an empty one", async () => {
    const res = await secretSyncHandler({ store, zoho: zohoStub(), expected: undefined, provided: "" });
    expect(res.status).toBe(503);
  });

  it("ignores whatever the webhook body claims: only Zoho's own API answers matter", async () => {
    const listItems = vi.fn(async () => items);
    await secretSyncHandler({ store, zoho: zohoStub({ listItems }), expected: "whsec-123456789012", provided: "whsec-123456789012" });
    expect(listItems).toHaveBeenCalledTimes(1);
  });
});
