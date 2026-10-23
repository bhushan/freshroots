import { and, desc, eq, or, sql } from "drizzle-orm";
import * as t from "@/db/schema";
import type { Db, Store } from "@/db/store";
import { ZohoError, type ZohoClient } from "@/lib/zoho/client";

export type PoOutcome =
  | { ok: true; status: "created"; id: string; number: string }
  | { ok: false; code: "NOT_FOUND" | "NOT_CONFIGURED" | "IN_PROGRESS" | "VENDOR_NOT_FOUND" | "ITEM_NOT_FOUND" | "ZOHO_ERROR"; message: string };

export const purchaseReference = (recommendationId: string, skuId: string) => `FR-${skuId}-${recommendationId.slice(0, 8)}`;

/**
 * Records that an approved or overridden recommendation needs a purchase order. Runs inside the review
 * transaction, so the decision and its pending order commit together. Maintain and Pause items propose no
 * purchase, and a quantity of 0 is not an order.
 */
export async function queuePurchaseOrder(
  tx: Db,
  rec: { id: string; skuId: string; action: string; reviewStatus: string; finalQty: number | null },
): Promise<void> {
  if (rec.reviewStatus !== "approved" && rec.reviewStatus !== "overridden") return;
  if (rec.action === "MAINTAIN_MONITOR" || rec.action === "PAUSE_NEXT_ORDER") return;
  if (rec.finalQty === null || rec.finalQty <= 0) return;
  await tx
    .insert(t.purchaseOrders)
    .values({ recommendationId: rec.id, qty: rec.finalQty, reference: purchaseReference(rec.id, rec.skuId) })
    .onConflictDoNothing({ target: t.purchaseOrders.recommendationId });
}

/** A pending order whose send started less than this long ago is treated as still running. */
const LEASE_SECONDS = 60;

/**
 * Sends one queued order to Zoho Books. Safe to call repeatedly: a created order is returned as is, a failed
 * one is retried, and two simultaneous calls cannot both send. A Zoho failure is recorded on the order and
 * never touches the planner's decision.
 */
export async function sendPurchaseOrder(store: Store, recommendationId: string, deps: { zoho: ZohoClient | null; today?: string }): Promise<PoOutcome> {
  const { db } = store;
  const [existing] = await db.select().from(t.purchaseOrders).where(eq(t.purchaseOrders.recommendationId, recommendationId));
  if (!existing) return { ok: false, code: "NOT_FOUND", message: "No purchase order is queued for this recommendation. Only approved or overridden orders with a quantity are sent." };
  if (existing.status === "created" && existing.zohoPoId) return { ok: true, status: "created", id: existing.zohoPoId, number: existing.zohoPoNumber ?? "" };
  if (!deps.zoho) return { ok: false, code: "NOT_CONFIGURED", message: "Zoho Books is not connected. Set the ZOHO_* variables, then send the order again." };

  const [claimed] = await db
    .update(t.purchaseOrders)
    .set({ attempts: sql`${t.purchaseOrders.attempts} + 1`, updatedAt: new Date() })
    .where(
      and(
        eq(t.purchaseOrders.id, existing.id),
        or(
          eq(t.purchaseOrders.status, "failed"),
          and(eq(t.purchaseOrders.status, "pending"), or(eq(t.purchaseOrders.attempts, 0), sql`${t.purchaseOrders.updatedAt} < now() - make_interval(secs => ${LEASE_SECONDS})`)),
        ),
      ),
    )
    .returning();
  if (!claimed) return { ok: false, code: "IN_PROGRESS", message: "This order is already being sent to Zoho Books." };

  const fail = async (code: Exclude<Extract<PoOutcome, { ok: false }>["code"], "NOT_FOUND" | "NOT_CONFIGURED" | "IN_PROGRESS">, message: string): Promise<PoOutcome> => {
    await db.update(t.purchaseOrders).set({ status: "failed", error: message, updatedAt: new Date() }).where(eq(t.purchaseOrders.id, existing.id));
    return { ok: false, code, message };
  };

  try {
    const [row] = await db
      .select({ rec: t.recommendations, sku: t.skus, distributor: t.distributors })
      .from(t.recommendations)
      .innerJoin(t.skus, eq(t.skus.skuId, t.recommendations.skuId))
      .innerJoin(t.distributors, eq(t.distributors.distributorId, t.skus.distributorId))
      .where(eq(t.recommendations.id, recommendationId));
    const [decision] = await db.select().from(t.reviewActions).where(eq(t.reviewActions.recommendationId, recommendationId)).orderBy(desc(t.reviewActions.createdAt)).limit(1);

    let vendorId = row.distributor.zohoVendorId;
    if (!vendorId) {
      vendorId = await deps.zoho.findVendorId(row.distributor.name);
      if (!vendorId) {
        return fail("VENDOR_NOT_FOUND", `Vendor "${row.distributor.name}" was not found in Zoho Books. Create it as a vendor with exactly that name, or set zoho_vendor_id on distributor ${row.distributor.distributorId}.`);
      }
      await db.update(t.distributors).set({ zohoVendorId: vendorId }).where(eq(t.distributors.distributorId, row.distributor.distributorId));
    }

    let itemId = row.sku.zohoItemId;
    if (!itemId) {
      itemId = await deps.zoho.findItemId(row.sku.skuId);
      if (!itemId) {
        return fail("ITEM_NOT_FOUND", `No Zoho Books item has the SKU "${row.sku.skuId}". Add the item with that SKU, or set zoho_item_id on the SKU.`);
      }
      await db.update(t.skus).set({ zohoItemId: itemId }).where(eq(t.skus.skuId, row.sku.skuId));
    }

    let order = await deps.zoho.findPurchaseOrderByReference(existing.reference);
    if (!order) {
      const who = decision?.reviewer ? ` by ${decision.reviewer}` : "";
      const note = decision?.note ? ` Note: ${decision.note}` : "";
      order = await deps.zoho.createPurchaseOrder({
        vendorId,
        itemId,
        quantity: existing.qty,
        reference: existing.reference,
        date: deps.today ?? new Date().toISOString().slice(0, 10),
        notes: `Freshroots recommendation ${row.rec.reviewStatus}${who}.${note}`.slice(0, 500),
      });
    }

    await db
      .update(t.purchaseOrders)
      .set({ status: "created", zohoPoId: order.id, zohoPoNumber: order.number, error: null, updatedAt: new Date() })
      .where(eq(t.purchaseOrders.id, existing.id));
    return { ok: true, status: "created", id: order.id, number: order.number };
  } catch (e) {
    return fail("ZOHO_ERROR", e instanceof ZohoError ? e.message : "Unexpected error while sending the order to Zoho Books.");
  }
}
