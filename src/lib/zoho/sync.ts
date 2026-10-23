import { eq } from "drizzle-orm";
import * as t from "@/db/schema";
import type { Store } from "@/db/store";
import type { ZohoClient } from "./client";

export type SyncResult =
  | {
      ok: true;
      scanned: number;
      /** Existing SKUs linked to (or renamed from) their Zoho item. */
      linked: number;
      /** SKUs created from Zoho items we had not seen. */
      created: number;
      ignored: number;
      skipped: { sku: string; reason: string }[];
      /** New SKUs where a planning field was not in Zoho and a documented default was used. */
      defaulted: { sku: string; fields: string[] }[];
    }
  | { ok: false; message: string };

/**
 * Pulls items from Zoho Books into the SKU master.
 *
 * - A SKU we already have is linked to its Zoho item and takes Zoho's name. Planning fields
 *   (reorder quantity, perishability, distributor, unit) stay ours, because they feed the rules.
 * - An unknown SKU code is created only when Zoho gives a preferred vendor we can match to a distributor and a
 *   reorder level. Perishability and category come from custom fields of that name, else a stated default.
 * - Nothing is deleted. Re-running is safe.
 *
 * The webhook and the button both call this and ignore any payload they were sent, so what lands
 * in the database is always what Zoho's API returns to us, not what a caller claims.
 */
export async function syncItemsFromZoho(store: Store, zoho: ZohoClient): Promise<SyncResult> {
  let items;
  try {
    items = await zoho.listItems();
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Zoho Books could not be read." };
  }

  const known = new Map((await store.db.select().from(t.skus)).map((s) => [s.skuId, s]));
  const result = { scanned: items.length, linked: 0, created: 0, ignored: 0, skipped: [] as { sku: string; reason: string }[], defaulted: [] as { sku: string; fields: string[] }[] };

  let vendorToDistributor: Map<string, string> | null = null;
  async function distributorFor(vendorId: string): Promise<string | undefined> {
    if (!vendorToDistributor) {
      vendorToDistributor = new Map();
      for (const d of await store.db.select().from(t.distributors)) {
        let zid = d.zohoVendorId;
        if (!zid) {
          zid = await zoho.findVendorId(d.name);
          if (zid) await store.db.update(t.distributors).set({ zohoVendorId: zid }).where(eq(t.distributors.distributorId, d.distributorId));
        }
        if (zid) vendorToDistributor.set(zid, d.distributorId);
      }
    }
    return vendorToDistributor.get(vendorId);
  }

  try {
    for (const item of items) {
      if (!item.active || !item.sku) {
        result.ignored += 1;
        continue;
      }
      const existing = known.get(item.sku);
      if (existing) {
        if (existing.zohoItemId !== item.itemId || (item.name && existing.name !== item.name)) {
          await store.db
            .update(t.skus)
            .set({ zohoItemId: item.itemId, name: item.name || existing.name, updatedAt: new Date() })
            .where(eq(t.skus.skuId, item.sku));
          result.linked += 1;
        }
        continue;
      }

      const detail = await zoho.getItem(item.itemId);
      if (!detail) {
        result.skipped.push({ sku: item.sku, reason: "Zoho no longer returns this item." });
        continue;
      }
      const distributorId = detail.vendorId ? await distributorFor(detail.vendorId) : undefined;
      if (!distributorId) {
        result.skipped.push({ sku: item.sku, reason: "Its preferred vendor in Zoho does not match any distributor here. Set a preferred vendor named like a distributor." });
        continue;
      }
      const reorder = detail.reorderLevel;
      if (reorder === undefined || !Number.isInteger(reorder) || reorder <= 0) {
        result.skipped.push({ sku: item.sku, reason: "It has no whole-number reorder level above 0 in Zoho, which becomes the standard reorder quantity." });
        continue;
      }

      const perishability = /^high$/i.test(detail.customFields?.perishability ?? "") ? "High" : /^low$/i.test(detail.customFields?.perishability ?? "") ? "Low" : null;
      const category = detail.customFields?.category || null;
      const defaults = [...(perishability ? [] : ["perishability"]), ...(category ? [] : ["category"])];

      await store.db.insert(t.skus).values({
        skuId: item.sku,
        name: detail.name || item.sku,
        category: category ?? "Uncategorised",
        perishability: perishability ?? "Low",
        standardReorderQty: reorder,
        unitOfMeasure: detail.unit || "Units",
        distributorId,
        zohoItemId: item.itemId,
      });
      result.created += 1;
      if (defaults.length) result.defaulted.push({ sku: item.sku, fields: defaults });
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "The sync failed part way. Run it again." };
  }

  return { ok: true, ...result };
}
