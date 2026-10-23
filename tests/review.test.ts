import { describe, expect, it } from "vitest";
import { decideReview, type ReviewTarget } from "@/lib/review/transitions";

const rec = (over: Partial<ReviewTarget> = {}): ReviewTarget => ({
  status: "pending",
  suggestedQty: 300,
  ...over,
});

describe("approve", () => {
  it("approves a pending recommendation at the suggested quantity", () => {
    expect(decideReview(rec(), { type: "approve" })).toEqual({ ok: true, newStatus: "approved", newQty: 300 });
  });

  it("approves a pause (quantity 0)", () => {
    expect(decideReview(rec({ suggestedQty: 0 }), { type: "approve" })).toEqual({ ok: true, newStatus: "approved", newQty: 0 });
  });

  it("cannot plainly approve a manual-review recommendation that has no quantity", () => {
    const r = decideReview(rec({ suggestedQty: null }), { type: "approve" });
    expect(r).toMatchObject({ ok: false, code: "NO_QUANTITY" });
  });

  it("can approve after the item was marked for investigation", () => {
    expect(decideReview(rec({ status: "investigating" }), { type: "approve" })).toMatchObject({ ok: true, newStatus: "approved" });
  });
});

describe("reject", () => {
  it("rejects with no quantity, including manual-review items", () => {
    expect(decideReview(rec(), { type: "reject" })).toEqual({ ok: true, newStatus: "rejected", newQty: null });
    expect(decideReview(rec({ suggestedQty: null }), { type: "reject" })).toMatchObject({ ok: true, newStatus: "rejected" });
  });
});

describe("override", () => {
  it("records the planner quantity", () => {
    expect(decideReview(rec(), { type: "override", overrideQty: 450 })).toEqual({ ok: true, newStatus: "overridden", newQty: 450 });
  });

  it("is the way to resolve a manual-review item", () => {
    expect(decideReview(rec({ suggestedQty: null }), { type: "override", overrideQty: 100 })).toMatchObject({ ok: true, newQty: 100 });
  });

  it("requires a whole, non-negative quantity", () => {
    for (const q of [undefined, -1, 1.5, Number.NaN]) {
      expect(decideReview(rec(), { type: "override", overrideQty: q as number }), String(q)).toMatchObject({ ok: false, code: "INVALID_QTY" });
    }
  });

  it("refuses an override equal to the suggestion", () => {
    expect(decideReview(rec(), { type: "override", overrideQty: 300 })).toMatchObject({ ok: false, code: "INVALID_QTY" });
  });
});

describe("investigate", () => {
  it("moves a pending item to investigating and keeps the quantity open", () => {
    expect(decideReview(rec(), { type: "investigate" })).toEqual({ ok: true, newStatus: "investigating", newQty: null });
  });

  it("cannot investigate twice", () => {
    expect(decideReview(rec({ status: "investigating" }), { type: "investigate" })).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
  });
});

describe("final states are terminal", () => {
  it("allows no further action once approved, rejected or overridden", () => {
    for (const status of ["approved", "rejected", "overridden"] as const) {
      for (const type of ["approve", "reject", "investigate"] as const) {
        expect(decideReview(rec({ status }), { type }), `${status} -> ${type}`).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
      }
      expect(decideReview(rec({ status }), { type: "override", overrideQty: 5 })).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    }
  });
});
