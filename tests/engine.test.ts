import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeSku, ceilQty, type EngineInput } from "@/lib/rules/engine";
import { RULES } from "@/lib/rules/config";

/** Consecutive observed weeks of 2026 starting at W01. */
function weeks(units: number[], startWeek = 1) {
  return units.map((u, i) => ({ isoYear: 2026, isoWeek: startWeek + i, units: u }));
}
const flat = (n: number, units = 100) => weeks(Array(n).fill(units));

function input(over: Partial<EngineInput> = {}): EngineInput {
  return {
    sku: { skuId: "SKU999", name: "Test SKU", category: "Test", perishability: "Low", standardReorderQty: 200 },
    sales: flat(16),
    unitsOnHand: 800,
    festivalMonth: false,
    ...over,
  };
}
const codes = (r: ReturnType<typeof analyzeSku>) => r.flags.map((f) => f.code);

describe("normal demand, normal stock", () => {
  it("maintains and monitors", () => {
    const r = analyzeSku(input());
    expect(r.avg4Raw).toBe(100);
    expect(r.avg12Raw).toBe(100);
    expect(r.coverageWeeks).toBe(8);
    expect(r.flags).toEqual([]);
    expect(r.action).toBe("MAINTAIN_MONITOR");
    expect(r.suggestedQty).toBe(0);
  });
});

describe("high demand", () => {
  const spike = weeks([...Array(8).fill(100), ...Array(4).fill(200)]);

  it("flags when adjusted 4-week average is more than 20% above the 12-week average", () => {
    const r = analyzeSku(input({ sales: spike, unitsOnHand: 1000 }));
    expect(codes(r)).toEqual(["HIGH_DEMAND"]);
    expect(r.action).toBe("REORDER_HIGH_DEMAND");
    expect(r.suggestedQty).toBe(300); // 1.5 x 200
  });

  it("does not flag at exactly 20%", () => {
    const exact = weeks([...Array(8).fill(300), ...Array(4).fill(400)]);
    const r = analyzeSku(input({ sales: exact, unitsOnHand: 2000 }));
    expect(codes(r)).not.toContain("HIGH_DEMAND");
  });

  it("uses only the latest 12 observed weeks", () => {
    const r = analyzeSku(input({ sales: weeks([5000, 5000, 5000, 5000, ...Array(8).fill(100), ...Array(4).fill(200)]), unitsOnHand: 1000 }));
    expect(r.avg12Raw).toBeCloseTo(133.333, 3);
  });
});

describe("ordinary SKU stock thresholds", () => {
  it("flags stockout below 6 weeks and proposes the standard quantity", () => {
    const r = analyzeSku(input({ unitsOnHand: 500 }));
    expect(codes(r)).toEqual(["STOCKOUT_RISK"]);
    expect(r.action).toBe("REORDER_IMMEDIATE");
    expect(r.suggestedQty).toBe(200);
  });

  it("is not a stockout at exactly 6 weeks", () => {
    expect(codes(analyzeSku(input({ unitsOnHand: 600 })))).toEqual([]);
  });

  it("flags overstock above 14 weeks and pauses the next order", () => {
    const r = analyzeSku(input({ unitsOnHand: 1500 }));
    expect(codes(r)).toEqual(["OVERSTOCK_RISK"]);
    expect(r.action).toBe("PAUSE_NEXT_ORDER");
    expect(r.suggestedQty).toBe(0);
  });

  it("is not an overstock at exactly 14 weeks", () => {
    expect(codes(analyzeSku(input({ unitsOnHand: 1400 })))).toEqual([]);
  });
});

describe("high-perishability thresholds", () => {
  const high = { skuId: "SKU998", name: "Fresh", category: "Dairy Alt", perishability: "High" as const, standardReorderQty: 150 };

  it("flags stockout below 3 weeks", () => {
    const r = analyzeSku(input({ sku: high, unitsOnHand: 250 }));
    expect(codes(r)).toEqual(["STOCKOUT_RISK"]);
    expect(r.action).toBe("REORDER_IMMEDIATE");
    expect(r.suggestedQty).toBe(150);
  });

  it("treats 3 to 4 weeks as normal, boundaries included", () => {
    for (const stock of [300, 350, 400]) {
      expect(codes(analyzeSku(input({ sku: high, unitsOnHand: stock }))), String(stock)).toEqual([]);
    }
  });

  it("flags overstock above 4 weeks and pauses", () => {
    const r = analyzeSku(input({ sku: high, unitsOnHand: 450 }));
    expect(codes(r)).toEqual(["OVERSTOCK_RISK"]);
    expect(r.action).toBe("PAUSE_NEXT_ORDER");
  });

  it("does not apply the ordinary 6 and 14 week thresholds", () => {
    // 5 weeks: fine for an ordinary SKU, overstock for a perishable one.
    expect(codes(analyzeSku(input({ unitsOnHand: 500 })))).toEqual(["STOCKOUT_RISK"]);
    expect(codes(analyzeSku(input({ sku: high, unitsOnHand: 500 })))).toEqual(["OVERSTOCK_RISK"]);
  });
});

describe("festival uplift", () => {
  it("applies 25% once to both averages and uses the adjusted 12-week average for coverage", () => {
    const r = analyzeSku(input({ festivalMonth: true, unitsOnHand: 600 }));
    expect(r.festivalUpliftApplied).toBe(true);
    expect(r.avg4Raw).toBe(100);
    expect(r.avg12Raw).toBe(100);
    expect(r.avg4Adjusted).toBe(125);
    expect(r.avg12Adjusted).toBe(125);
    expect(r.coverageWeeks).toBeCloseTo(4.8, 10);
    expect(codes(r)).toEqual(["STOCKOUT_RISK"]);
  });

  it("changes nothing outside festival months", () => {
    const r = analyzeSku(input({ festivalMonth: false, unitsOnHand: 600 }));
    expect(r.festivalUpliftApplied).toBe(false);
    expect(r.avg12Adjusted).toBe(r.avg12Raw);
    expect(codes(r)).toEqual([]);
  });

  it("leaves the high-demand ratio unchanged because both sides scale", () => {
    const spike = weeks([...Array(8).fill(100), ...Array(4).fill(200)]);
    const a = analyzeSku(input({ sales: spike, unitsOnHand: 1200, festivalMonth: true }));
    const b = analyzeSku(input({ sales: spike, unitsOnHand: 1200, festivalMonth: false }));
    expect(codes(a)).toEqual(["HIGH_DEMAND"]);
    expect(codes(b)).toEqual(["HIGH_DEMAND"]);
  });
});

describe("conflicting signals", () => {
  const spike = weeks([...Array(8).fill(100), ...Array(4).fill(200)]);

  it("sends overstock plus high demand to manual review and keeps both flags", () => {
    const r = analyzeSku(input({ sales: spike, unitsOnHand: 3000 }));
    expect(codes(r)).toEqual(expect.arrayContaining(["HIGH_DEMAND", "OVERSTOCK_RISK"]));
    expect(r.action).toBe("MANUAL_REVIEW_CONFLICT");
    expect(r.suggestedQty).toBeNull();
    expect(r.requiresManualReview).toBe(true);
  });

  it("never reports stockout and overstock together", () => {
    for (const perishability of ["Low", "High"] as const) {
      for (let stock = 0; stock <= 3000; stock += 25) {
        const r = analyzeSku(input({ sku: { ...input().sku, perishability }, unitsOnHand: stock }));
        const c = codes(r);
        expect(c.includes("STOCKOUT_RISK") && c.includes("OVERSTOCK_RISK"), `${perishability} ${stock}`).toBe(false);
      }
    }
  });

  it("lets high demand outrank plain stockout", () => {
    const r = analyzeSku(input({ sales: spike, unitsOnHand: 400 }));
    expect(codes(r)).toEqual(expect.arrayContaining(["HIGH_DEMAND", "STOCKOUT_RISK"]));
    expect(r.action).toBe("REORDER_HIGH_DEMAND");
    expect(r.suggestedQty).toBe(300);
  });
});

describe("insufficient history", () => {
  it("flags fewer than 12 distinct weeks and does not invent zeros", () => {
    const r = analyzeSku(input({ sales: flat(8, 100) }));
    expect(codes(r)).toEqual(["INSUFFICIENT_DATA"]);
    expect(r.avg12Raw).toBeNull();
    expect(r.avg12Adjusted).toBeNull();
    expect(r.coverageWeeks).toBeNull();
    expect(r.avg4Raw).toBe(100);
    expect(r.action).toBe("MANUAL_REVIEW_INSUFFICIENT_DATA");
    expect(r.suggestedQty).toBeNull();
    expect(r.distinctWeeks).toBe(8);
  });

  it("warns about a gap inside the window but averages observed weeks only", () => {
    const sales = [...weeks(Array(10).fill(100)), ...weeks([100, 100, 100, 100], 12)];
    const r = analyzeSku(input({ sales }));
    expect(r.warnings.join(" ")).toMatch(/missing week/i);
    expect(r.avg12Raw).toBe(100);
  });

  it("sorts by ISO week, not input order", () => {
    const sales = [...flat(16)].reverse();
    expect(analyzeSku(input({ sales })).latestWeek).toBe("2026-W16");
  });
});

describe("zero and missing data", () => {
  it("treats zero demand with stock on hand as overstock with a warning", () => {
    const r = analyzeSku(input({ sales: flat(16, 0), unitsOnHand: 100 }));
    expect(r.coverageWeeks).toBeNull();
    expect(codes(r)).toEqual(["OVERSTOCK_RISK"]);
    expect(r.action).toBe("PAUSE_NEXT_ORDER");
    expect(r.warnings.join(" ")).toMatch(/zero/i);
  });

  it("maintains when both demand and stock are zero", () => {
    const r = analyzeSku(input({ sales: flat(16, 0), unitsOnHand: 0 }));
    expect(codes(r)).toEqual([]);
    expect(r.action).toBe("MAINTAIN_MONITOR");
    expect(r.warnings.join(" ")).toMatch(/zero/i);
  });

  it("sends a missing inventory row to manual review", () => {
    const r = analyzeSku(input({ unitsOnHand: null }));
    expect(r.action).toBe("MANUAL_REVIEW_MISSING_INVENTORY");
    expect(r.suggestedQty).toBeNull();
    expect(r.warnings.join(" ")).toMatch(/inventory/i);
  });
});

describe("rounding", () => {
  it("rounds suggested quantities up to the next whole unit", () => {
    expect(ceilQty(499.5)).toBe(500);
    expect(ceilQty(120)).toBe(120);
    expect(ceilQty(10.5)).toBe(11);
    expect(ceilQty(1.5)).toBe(2);
  });

  it("applies the 1.5x multiplier with ceiling to the standard quantity", () => {
    const spike = weeks([...Array(8).fill(100), ...Array(4).fill(200)]);
    for (const [std, expected] of [[333, 500], [80, 120], [7, 11]] as const) {
      const r = analyzeSku(input({ sales: spike, unitsOnHand: 1000, sku: { ...input().sku, standardReorderQty: std } }));
      expect(r.suggestedQty, String(std)).toBe(expected);
    }
  });
});

describe("determinism and isolation", () => {
  it("returns identical results for identical input", () => {
    const i = input({ sales: weeks([90, 95, 100, 110, 120, 130, 90, 100, 105, 100, 99, 101, 140]), unitsOnHand: 321 });
    expect(analyzeSku(i)).toEqual(analyzeSku(structuredClone(i)));
  });

  it("does not mutate its input", () => {
    const i = input({ sales: [...flat(16)].reverse() });
    const before = structuredClone(i);
    analyzeSku(i);
    expect(i).toEqual(before);
  });

  it("keeps the engine free of I/O and AI imports", () => {
    for (const f of ["engine.ts", "config.ts"]) {
      const src = readFileSync(path.join(__dirname, "../src/lib/rules", f), "utf8");
      expect(src).not.toMatch(/@google\/genai|fetch\(|from "node:|process\.env/);
    }
  });

  it("exposes the documented thresholds in one config", () => {
    expect(RULES.festivalMonths).toEqual([3, 10, 11]);
    expect(RULES.festivalUplift).toBe(1.25);
    expect(RULES.highDemandRatio).toBe(1.2);
    expect(RULES.highDemandQtyMultiplier).toBe(1.5);
    expect(RULES.ordinary).toEqual({ stockoutBelowWeeks: 6, overstockAboveWeeks: 14 });
    expect(RULES.highPerishability).toEqual({ stockoutBelowWeeks: 3, overstockAboveWeeks: 4 });
  });
});
