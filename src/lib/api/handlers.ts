import { eq } from "drizzle-orm";
import Papa from "papaparse";
import { purchaseOrders } from "@/db/schema";
import type { Store } from "@/db/store";
import { sendPurchaseOrder, type PoOutcome } from "@/lib/procurement/service";
import { syncItemsFromZoho } from "@/lib/zoho/sync";
import type { ZohoClient } from "@/lib/zoho/client";
import { generateExplanation, generateSummary, type AiDeps, type AiErrorCode } from "@/lib/ai/service";
import { runAnalysis } from "@/lib/analysis/run";
import { checkAdmin, createSessionToken, isAdminConfigured, safeEqual, verifyPassword, type AuthEnv } from "@/lib/auth/session";
import { approvedForExport, reviewRecommendation } from "@/lib/review/service";
import { DEFAULT_REVIEWER, loginBody, reviewBody, skuIdParam, uuidParam } from "./schemas";

/**
 * Framework-free request handlers. The route files only read the cookie/body and call these,
 * which keeps validation, the admin gate and status mapping unit-testable.
 */
export interface ApiResult {
  status: number;
  body: unknown;
}

const invalid = (issues: unknown): ApiResult => ({ status: 400, body: { error: "INVALID_REQUEST", issues } });

function gate(token: string | undefined, env: AuthEnv): ApiResult | null {
  const check = checkAdmin(token, env);
  return check.ok ? null : { status: check.status, body: { error: check.code, message: check.message } };
}

const REVIEW_STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  STALE_RUN: 409,
  INVALID_TRANSITION: 409,
  NO_QUANTITY: 422,
  INVALID_QTY: 422,
};

export async function reviewHandler(args: {
  store: Store;
  env: AuthEnv;
  token: string | undefined;
  recId: string;
  rawBody: unknown;
  /** Zoho Books client; null or absent leaves any order pending. */
  zoho?: ZohoClient | null;
}): Promise<ApiResult> {
  const denied = gate(args.token, args.env);
  if (denied) return denied;
  const id = uuidParam.safeParse(args.recId);
  if (!id.success) return invalid(id.error.issues);
  const body = reviewBody.safeParse(args.rawBody);
  if (!body.success) return invalid(body.error.issues);

  const result = await reviewRecommendation(args.store, {
    recommendationId: id.data,
    type: body.data.type,
    overrideQty: body.data.overrideQty,
    note: body.data.note || undefined,
    reviewer: body.data.reviewer ?? DEFAULT_REVIEWER,
  });
  if (!result.ok) return { status: REVIEW_STATUS[result.code] ?? 400, body: { error: result.code, message: result.message } };

  // The decision is already committed. Placing the order is a separate step, so a Zoho outage can never undo it.
  const purchaseOrder = await placeOrder(args.store, result.recommendation.id, args.zoho ?? null);
  return { status: 200, body: { recommendation: result.recommendation, ...(purchaseOrder ? { purchaseOrder } : {}) } };
}

type PoSummary = { status: "created" | "pending" | "failed"; number?: string; code?: string; message?: string };

/** Sends the order queued by this decision, if any. Returns null when the decision does not need an order. */
async function placeOrder(store: Store, recommendationId: string, zoho: ZohoClient | null): Promise<PoSummary | null> {
  const [queued] = await store.db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.recommendationId, recommendationId));
  if (!queued) return null;
  return summarisePo(await sendPurchaseOrder(store, recommendationId, { zoho }));
}

function summarisePo(r: PoOutcome): PoSummary {
  if (r.ok) return { status: "created", number: r.number };
  return { status: r.code === "NOT_CONFIGURED" || r.code === "IN_PROGRESS" ? "pending" : "failed", code: r.code, message: r.message };
}

const PO_STATUS: Record<string, number> = { NOT_FOUND: 404, NOT_CONFIGURED: 503, IN_PROGRESS: 409, VENDOR_NOT_FOUND: 422, ITEM_NOT_FOUND: 422, ZOHO_ERROR: 502 };

/** Retries (or first sends) the Zoho purchase order for an approved or overridden recommendation. */
export async function purchaseOrderHandler(args: { store: Store; env: AuthEnv; token: string | undefined; recId: string; zoho: ZohoClient | null }): Promise<ApiResult> {
  const denied = gate(args.token, args.env);
  if (denied) return denied;
  const id = uuidParam.safeParse(args.recId);
  if (!id.success) return invalid(id.error.issues);
  const r = await sendPurchaseOrder(args.store, id.data, { zoho: args.zoho });
  if (!r.ok) return { status: PO_STATUS[r.code] ?? 400, body: { error: r.code, message: r.message, purchaseOrder: summarisePo(r) } };
  return { status: 200, body: { purchaseOrder: summarisePo(r) } };
}

async function runSync(store: Store, zoho: ZohoClient | null): Promise<ApiResult> {
  if (!zoho) return { status: 503, body: { error: "NOT_CONFIGURED", message: "Zoho Books is not connected. Set the ZOHO_* variables first." } };
  const r = await syncItemsFromZoho(store, zoho);
  if (!r.ok) return { status: 502, body: { error: "ZOHO_ERROR", message: r.message } };
  return { status: 200, body: { scanned: r.scanned, linked: r.linked, created: r.created, ignored: r.ignored, skipped: r.skipped, defaulted: r.defaulted } };
}

/** Planner-triggered item sync from the Overview page. */
export async function zohoSyncHandler(args: { store: Store; env: AuthEnv; token: string | undefined; zoho: ZohoClient | null }): Promise<ApiResult> {
  const denied = gate(args.token, args.env);
  if (denied) return denied;
  return runSync(args.store, args.zoho);
}

/**
 * Sync triggered by Zoho's webhook. It proves itself with a shared secret, not a session,
 * and whatever it sends is ignored: the sync always re-reads Zoho's own API, so a forged body changes nothing.
 */
export async function secretSyncHandler(args: { store: Store; zoho: ZohoClient | null; expected: string | undefined; provided: string | undefined }): Promise<ApiResult> {
  if (!args.expected || args.expected.length < 12) return { status: 503, body: { error: "NOT_CONFIGURED", message: "No shared secret is configured for this endpoint." } };
  if (!args.provided || !safeEqual(args.provided, args.expected)) return { status: 401, body: { error: "UNAUTHENTICATED", message: "Invalid secret." } };
  return runSync(args.store, args.zoho);
}

export async function analysisRunHandler(args: { store: Store; env: AuthEnv; token: string | undefined }): Promise<ApiResult> {
  const denied = gate(args.token, args.env);
  if (denied) return denied;
  const result = await runAnalysis(args.store);
  if (!result.ok) return { status: 409, body: { error: result.code, message: result.message } };
  return { status: 200, body: { runId: result.runId, summary: result.summary } };
}

const AI_STATUS: Record<AiErrorCode, number> = {
  NOT_CONFIGURED: 503,
  NO_DATA: 409,
  NOT_FOUND: 404,
  THROTTLED: 429,
  QUOTA: 429,
  TIMEOUT: 504,
  INVALID_RESPONSE: 502,
  UNAVAILABLE: 502,
};

export async function aiSummaryHandler(args: { store: Store; env: AuthEnv; token: string | undefined; deps: AiDeps }): Promise<ApiResult> {
  const denied = gate(args.token, args.env);
  if (denied) return denied;
  const r = await generateSummary(args.store, args.deps);
  if (!r.ok) return { status: AI_STATUS[r.code], body: { error: r.code, message: r.message } };
  return { status: 200, body: { data: r.data, cached: r.cached, model: r.model } };
}

export async function aiExplainHandler(args: {
  store: Store;
  env: AuthEnv;
  token: string | undefined;
  skuId: string;
  deps: AiDeps;
}): Promise<ApiResult> {
  const denied = gate(args.token, args.env);
  if (denied) return denied;
  const sku = skuIdParam.safeParse(args.skuId);
  if (!sku.success) return invalid(sku.error.issues);
  const r = await generateExplanation(args.store, sku.data, args.deps);
  if (!r.ok) return { status: AI_STATUS[r.code], body: { error: r.code, message: r.message } };
  return { status: 200, body: { data: r.data, cached: r.cached, model: r.model } };
}

export async function loginHandler(args: {
  env: AuthEnv;
  rawBody: unknown;
  /** Pause after a wrong password to blunt guessing. Tests pass 0. */
  delayMs?: number;
}): Promise<ApiResult & { sessionToken?: string }> {
  if (!isAdminConfigured(args.env)) {
    const check = checkAdmin(undefined, args.env);
    if (!check.ok && check.status === 403) return { status: 403, body: { error: check.code, message: check.message } };
  }
  const body = loginBody.safeParse(args.rawBody);
  if (!body.success) return invalid(body.error.issues);
  if (!verifyPassword(body.data.password, args.env)) {
    await new Promise((resolve) => setTimeout(resolve, args.delayMs ?? 600));
    return { status: 401, body: { error: "INVALID_CREDENTIALS", message: "Incorrect password." } };
  }
  return { status: 200, body: { ok: true }, sessionToken: createSessionToken(args.env.SESSION_SECRET as string) };
}

export const EXPORT_COLUMNS = [
  "SKU_ID",
  "SKU_Name",
  "Distributor_ID",
  "Review_Status",
  "Recommended_Action",
  "System_Suggested_Qty",
  "Approved_Qty",
  "Unit_of_Measure",
  "Reviewer",
  "Review_Note",
  "Reviewed_At",
  "Inventory_Snapshot_Date",
  "Analysis_Run_ID",
] as const;

/** Approved and overridden items as CSV for manual procurement handoff. Formula-escaped for spreadsheets. */
export async function exportCsvHandler(store: Store): Promise<string> {
  const rows = await approvedForExport(store.db);
  return Papa.unparse(
    {
      fields: [...EXPORT_COLUMNS],
      data: rows.map((r) => [
        r.skuId,
        r.skuName,
        r.distributorId,
        r.reviewStatus,
        r.action,
        r.suggestedQty ?? "",
        r.finalQty ?? "",
        r.unitOfMeasure,
        r.reviewer,
        r.note,
        r.reviewedAt?.toISOString() ?? "",
        r.snapshotDate,
        r.runId,
      ]),
    },
    { escapeFormulae: true, newline: "\n" },
  );
}
