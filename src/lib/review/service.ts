import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import * as t from "@/db/schema";
import type { Db, Store } from "@/db/store";
import { getLatestRun } from "@/lib/analysis/run";
import { queuePurchaseOrder } from "@/lib/procurement/service";
import { decideReview, type ReviewType } from "./transitions";

export interface ReviewInput {
  recommendationId: string;
  type: ReviewType;
  overrideQty?: number;
  note?: string;
  reviewer: string;
}

export type ReviewOutcome =
  | { ok: true; recommendation: typeof t.recommendations.$inferSelect }
  | { ok: false; code: "NOT_FOUND" | "STALE_RUN" | "INVALID_TRANSITION" | "NO_QUANTITY" | "INVALID_QTY"; message: string };

/**
 * Applies one planner decision. The status change and its audit row commit together or not at all,
 * and the recommendation row is locked so two simultaneous clicks cannot both succeed.
 */
export async function reviewRecommendation(store: Store, input: ReviewInput): Promise<ReviewOutcome> {
  return store.tx(async (tx): Promise<ReviewOutcome> => {
    const [rec] = await tx
      .select()
      .from(t.recommendations)
      .where(eq(t.recommendations.id, input.recommendationId))
      .for("update");
    if (!rec) return { ok: false, code: "NOT_FOUND", message: "Recommendation not found." };

    const latest = await getLatestRun(tx);
    if (latest?.id !== rec.runId) {
      return { ok: false, code: "STALE_RUN", message: "This recommendation belongs to an older analysis run. Review the latest run instead." };
    }

    const decision = decideReview(
      { status: rec.reviewStatus, suggestedQty: rec.suggestedQty },
      { type: input.type, overrideQty: input.overrideQty },
    );
    if (!decision.ok) return decision;

    const [updated] = await tx
      .update(t.recommendations)
      .set({ reviewStatus: decision.newStatus, finalQty: decision.newQty, reviewedAt: new Date() })
      .where(eq(t.recommendations.id, rec.id))
      .returning();

    await tx.insert(t.reviewActions).values({
      recommendationId: rec.id,
      action: input.type,
      reviewer: input.reviewer,
      priorStatus: rec.reviewStatus,
      newStatus: decision.newStatus,
      priorQty: rec.finalQty ?? rec.suggestedQty,
      newQty: decision.newQty,
      note: input.note ?? null,
    });

    await queuePurchaseOrder(tx, updated);

    return { ok: true, recommendation: updated };
  });
}

export async function listReviewQueue(db: Db) {
  const run = await getLatestRun(db);
  if (!run) return { run: null, items: [], history: {} as Record<string, (typeof t.reviewActions.$inferSelect)[]> };

  const items = await db
    .select({
      id: t.recommendations.id,
      skuId: t.recommendations.skuId,
      skuName: t.skus.name,
      category: t.skus.category,
      perishability: t.skus.perishability,
      standardReorderQty: t.skus.standardReorderQty,
      action: t.recommendations.action,
      suggestedQty: t.recommendations.suggestedQty,
      finalQty: t.recommendations.finalQty,
      reviewStatus: t.recommendations.reviewStatus,
      flags: t.recommendations.flags,
      explanation: t.recommendations.explanation,
      reviewedAt: t.recommendations.reviewedAt,
    })
    .from(t.recommendations)
    .innerJoin(t.skus, eq(t.skus.skuId, t.recommendations.skuId))
    .where(eq(t.recommendations.runId, run.id))
    .orderBy(asc(t.recommendations.skuId));

  const actions = items.length
    ? await db
        .select()
        .from(t.reviewActions)
        .where(inArray(t.reviewActions.recommendationId, items.map((i) => i.id)))
        .orderBy(desc(t.reviewActions.createdAt))
    : [];
  const history: Record<string, typeof actions> = {};
  for (const a of actions) (history[a.recommendationId] ??= []).push(a);

  return { run, items, history };
}

/** Approved and overridden items of the latest run for manual procurement handoff. Maintain items propose no order, so they are left out. */
export async function approvedForExport(db: Db) {
  const run = await getLatestRun(db);
  if (!run) return [];
  const rows = await db
    .select({
      id: t.recommendations.id,
      skuId: t.recommendations.skuId,
      skuName: t.skus.name,
      distributorId: t.skus.distributorId,
      unitOfMeasure: t.skus.unitOfMeasure,
      action: t.recommendations.action,
      suggestedQty: t.recommendations.suggestedQty,
      finalQty: t.recommendations.finalQty,
      reviewStatus: t.recommendations.reviewStatus,
      reviewedAt: t.recommendations.reviewedAt,
    })
    .from(t.recommendations)
    .innerJoin(t.skus, eq(t.skus.skuId, t.recommendations.skuId))
    .where(and(eq(t.recommendations.runId, run.id), inArray(t.recommendations.reviewStatus, ["approved", "overridden"]), ne(t.recommendations.action, "MAINTAIN_MONITOR")))
    .orderBy(asc(t.recommendations.skuId));

  const last = rows.length
    ? await db
        .select()
        .from(t.reviewActions)
        .where(inArray(t.reviewActions.recommendationId, rows.map((r) => r.id)))
        .orderBy(desc(t.reviewActions.createdAt))
    : [];
  const latestByRec = new Map<string, (typeof last)[number]>();
  for (const a of last) if (!latestByRec.has(a.recommendationId)) latestByRec.set(a.recommendationId, a);

  return rows.map((r) => ({
    ...r,
    reviewer: latestByRec.get(r.id)?.reviewer ?? "",
    note: latestByRec.get(r.id)?.note ?? "",
    snapshotDate: run.snapshotDate,
    runId: run.id,
  }));
}
