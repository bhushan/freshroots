import type { ReviewStatus } from "@/db/schema";

export type ReviewType = "approve" | "reject" | "override" | "investigate";

export interface ReviewTarget {
  status: ReviewStatus;
  /** null for manual-review recommendations, which have no executable quantity. */
  suggestedQty: number | null;
}

export interface ReviewRequest {
  type: ReviewType;
  overrideQty?: number;
}

export type ReviewDecision =
  | { ok: true; newStatus: ReviewStatus; newQty: number | null }
  | { ok: false; code: "INVALID_TRANSITION" | "NO_QUANTITY" | "INVALID_QTY"; message: string };

/** Statuses a planner can still act on. approved, rejected and overridden are final. */
const OPEN: ReviewStatus[] = ["pending", "investigating"];

/**
 * Pure state machine for planner decisions:
 *   pending -> investigating | approved | rejected | overridden
 *   investigating -> approved | rejected | overridden
 * A re-run of the analysis creates fresh proposals, so final states never reopen.
 */
export function decideReview(target: ReviewTarget, req: ReviewRequest): ReviewDecision {
  const fail = (code: Extract<ReviewDecision, { ok: false }>["code"], message: string): ReviewDecision => ({
    ok: false,
    code,
    message,
  });

  if (!OPEN.includes(target.status)) {
    return fail("INVALID_TRANSITION", `Cannot ${req.type} a recommendation that is already ${target.status}.`);
  }

  switch (req.type) {
    case "investigate":
      if (target.status === "investigating") return fail("INVALID_TRANSITION", "Already marked for investigation.");
      return { ok: true, newStatus: "investigating", newQty: null };

    case "reject":
      return { ok: true, newStatus: "rejected", newQty: null };

    case "approve":
      if (target.suggestedQty === null) {
        return fail("NO_QUANTITY", "This item needs manual review and has no suggested quantity. Override it with a quantity or reject it.");
      }
      return { ok: true, newStatus: "approved", newQty: target.suggestedQty };

    case "override": {
      const q = req.overrideQty;
      if (q === undefined || !Number.isInteger(q) || q < 0) {
        return fail("INVALID_QTY", "Override quantity must be a whole number of 0 or more.");
      }
      if (q === target.suggestedQty) {
        return fail("INVALID_QTY", "Override quantity equals the suggestion. Approve it instead.");
      }
      return { ok: true, newStatus: "overridden", newQty: q };
    }
  }
}
