import { formatIsoWeek, isoWeekOrdinal } from "@/lib/iso-week";
import { RULES } from "./config";

export type Perishability = "Low" | "High";

export type FlagCode = "HIGH_DEMAND" | "STOCKOUT_RISK" | "OVERSTOCK_RISK" | "INSUFFICIENT_DATA";

export type ActionCode =
  | "REORDER_HIGH_DEMAND"
  | "REORDER_IMMEDIATE"
  | "PAUSE_NEXT_ORDER"
  | "MANUAL_REVIEW_CONFLICT"
  | "MANUAL_REVIEW_INSUFFICIENT_DATA"
  | "MANUAL_REVIEW_MISSING_INVENTORY"
  | "MAINTAIN_MONITOR";

export const ACTION_LABELS: Record<ActionCode, string> = {
  REORDER_HIGH_DEMAND: "Reorder 1.5x standard quantity (High Demand)",
  REORDER_IMMEDIATE: "Reorder immediately at standard quantity",
  PAUSE_NEXT_ORDER: "Pause next order",
  MANUAL_REVIEW_CONFLICT: "Manual Review: Conflicting Signals",
  MANUAL_REVIEW_INSUFFICIENT_DATA: "Manual Review: Insufficient Data",
  MANUAL_REVIEW_MISSING_INVENTORY: "Manual Review: Missing Inventory",
  MAINTAIN_MONITOR: "Maintain and Monitor",
};

export interface SalesObservation {
  isoYear: number;
  isoWeek: number;
  units: number;
}

export interface EngineInput {
  sku: {
    skuId: string;
    name: string;
    category: string;
    perishability: Perishability;
    standardReorderQty: number;
  };
  sales: SalesObservation[];
  /** null when the SKU has no row in the inventory snapshot. */
  unitsOnHand: number | null;
  festivalMonth: boolean;
}

export interface RuleFlag {
  code: FlagCode;
  rule: string;
  threshold: string;
  actual: string;
  explanation: string;
}

export interface SkuAnalysis {
  skuId: string;
  distinctWeeks: number;
  latestWeek: string | null;
  avg4Raw: number | null;
  avg12Raw: number | null;
  avg4Adjusted: number | null;
  avg12Adjusted: number | null;
  festivalUpliftApplied: boolean;
  unitsOnHand: number | null;
  coverageWeeks: number | null;
  flags: RuleFlag[];
  action: ActionCode;
  /** null = no executable quantity (manual review); 0 = order nothing. */
  suggestedQty: number | null;
  requiresManualReview: boolean;
  warnings: string[];
  explanation: string;
}

/** Rounds a suggested quantity up to the next whole unit, ignoring float noise. */
export function ceilQty(value: number): number {
  return Math.ceil(value - RULES.epsilon);
}

/** Step B. The only place the festival uplift is applied. */
function applyFestivalUplift(value: number | null, festival: boolean): number | null {
  if (value === null) return null;
  return festival ? value * RULES.festivalUplift : value;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

export function analyzeSku(input: EngineInput): SkuAnalysis {
  const { sku, festivalMonth, unitsOnHand } = input;
  const warnings: string[] = [];
  const flags: RuleFlag[] = [];

  // Step A: order by actual ISO week, never by input order.
  const sales = [...input.sales].sort((a, b) => a.isoYear - b.isoYear || a.isoWeek - b.isoWeek);
  const distinctWeeks = sales.length;
  const last = sales[sales.length - 1];
  const latestWeek = last ? formatIsoWeek(last.isoYear, last.isoWeek) : null;

  const shortWindow = sales.slice(-RULES.shortWindowWeeks);
  const longWindow = sales.slice(-RULES.longWindowWeeks);
  const hasShort = shortWindow.length >= RULES.shortWindowWeeks;
  const hasLong = longWindow.length >= RULES.longWindowWeeks;

  const avg4Raw = hasShort ? mean(shortWindow.map((s) => s.units)) : null;
  const avg12Raw = hasLong ? mean(longWindow.map((s) => s.units)) : null;

  if (hasLong) {
    const first = longWindow[0];
    const span =
      isoWeekOrdinal(last.isoYear, last.isoWeek) - isoWeekOrdinal(first.isoYear, first.isoWeek) + 1;
    if (span > longWindow.length) {
      warnings.push(
        `Missing week(s) inside the 12-week window: ${span - longWindow.length} calendar week(s) have no sales record. Averages use observed weeks only; gaps are not treated as zero.`,
      );
    }
  }

  // Step B: uplift applied exactly once, here.
  const avg4Adjusted = applyFestivalUplift(avg4Raw, festivalMonth);
  const avg12Adjusted = applyFestivalUplift(avg12Raw, festivalMonth);

  let coverageWeeks: number | null = null;
  const base = {
    skuId: sku.skuId,
    distinctWeeks,
    latestWeek,
    avg4Raw,
    avg12Raw,
    avg4Adjusted,
    avg12Adjusted,
    festivalUpliftApplied: festivalMonth,
    unitsOnHand,
  };

  if (!hasLong) {
    flags.push({
      code: "INSUFFICIENT_DATA",
      rule: "Minimum history",
      threshold: `at least ${RULES.longWindowWeeks} distinct observed weeks`,
      actual: `${distinctWeeks} distinct week(s)`,
      explanation: `Only ${distinctWeeks} week(s) of sales are available; a full ${RULES.longWindowWeeks}-week baseline needs ${RULES.longWindowWeeks}. Missing weeks are not treated as zero, so no coverage or demand rule was evaluated.`,
    });
    return {
      ...base,
      coverageWeeks,
      flags,
      action: "MANUAL_REVIEW_INSUFFICIENT_DATA",
      suggestedQty: null,
      requiresManualReview: true,
      warnings,
      explanation: `${ACTION_LABELS.MANUAL_REVIEW_INSUFFICIENT_DATA}. ${flags[0].explanation}`,
    };
  }

  const adj4 = avg4Adjusted as number;
  const adj12 = avg12Adjusted as number;
  const eps = RULES.epsilon;

  // Step C: High Demand.
  const highDemand = adj4 - adj12 * RULES.highDemandRatio > eps;
  if (highDemand) {
    flags.push({
      code: "HIGH_DEMAND",
      rule: "High Demand",
      threshold: `adjusted 4wk avg > adjusted 12wk avg x ${RULES.highDemandRatio}`,
      actual: `${fmt(adj4)} > ${fmt(adj12)} x ${RULES.highDemandRatio} = ${fmt(adj12 * RULES.highDemandRatio)}`,
      explanation: `Recent demand (${fmt(adj4)}/wk) is more than ${Math.round((RULES.highDemandRatio - 1) * 100)}% above the 12-week level (${fmt(adj12)}/wk).`,
    });
  }

  // Steps D and E: stock coverage. Perishable SKUs use their own thresholds only.
  const t = sku.perishability === "High" ? RULES.highPerishability : RULES.ordinary;
  const classLabel = sku.perishability === "High" ? "High-perishability" : "Standard";
  let stockout = false;
  let overstock = false;

  if (unitsOnHand === null) {
    warnings.push("No inventory row for this SKU in the latest snapshot; coverage cannot be calculated.");
  } else if (adj12 <= 0) {
    warnings.push("Zero average weekly sales over the 12-week window; stock coverage is undefined.");
    if (unitsOnHand > 0) {
      overstock = true;
      flags.push({
        code: "OVERSTOCK_RISK",
        rule: `${classLabel} overstock (no demand)`,
        threshold: "stock on hand with zero 12-week demand",
        actual: `${unitsOnHand} units on hand, 0/wk demand`,
        explanation: `${unitsOnHand} units are on hand but there were no sales in the 12-week window, so the stock is not being consumed.`,
      });
    }
  } else {
    coverageWeeks = unitsOnHand / adj12;
    if (coverageWeeks < t.stockoutBelowWeeks - eps) {
      stockout = true;
      flags.push({
        code: "STOCKOUT_RISK",
        rule: `${classLabel} stockout`,
        threshold: `coverage < ${t.stockoutBelowWeeks} weeks`,
        actual: `${unitsOnHand} / ${fmt(adj12)} = ${fmt(coverageWeeks)} weeks`,
        explanation: `Stock covers ${fmt(coverageWeeks)} weeks of demand, below the ${t.stockoutBelowWeeks}-week minimum for ${classLabel.toLowerCase()} SKUs.`,
      });
    } else if (coverageWeeks > t.overstockAboveWeeks + eps) {
      overstock = true;
      flags.push({
        code: "OVERSTOCK_RISK",
        rule: `${classLabel} overstock`,
        threshold: `coverage > ${t.overstockAboveWeeks} weeks`,
        actual: `${unitsOnHand} / ${fmt(adj12)} = ${fmt(coverageWeeks)} weeks`,
        explanation: `Stock covers ${fmt(coverageWeeks)} weeks of demand, above the ${t.overstockAboveWeeks}-week ceiling for ${classLabel.toLowerCase()} SKUs.`,
      });
    }
  }

  // Step F: precedence for the primary recommendation. All flags stay on the result.
  const reorderSignal = highDemand || stockout;
  let action: ActionCode;
  let suggestedQty: number | null;
  if (unitsOnHand === null) {
    action = "MANUAL_REVIEW_MISSING_INVENTORY";
    suggestedQty = null;
  } else if (overstock && reorderSignal) {
    action = "MANUAL_REVIEW_CONFLICT";
    suggestedQty = null;
  } else if (overstock) {
    action = "PAUSE_NEXT_ORDER";
    suggestedQty = 0;
  } else if (highDemand) {
    action = "REORDER_HIGH_DEMAND";
    suggestedQty = ceilQty(sku.standardReorderQty * RULES.highDemandQtyMultiplier);
  } else if (stockout) {
    action = "REORDER_IMMEDIATE";
    suggestedQty = ceilQty(sku.standardReorderQty);
  } else {
    action = "MAINTAIN_MONITOR";
    suggestedQty = 0;
  }

  const flagText = flags.length ? flags.map((f) => f.explanation).join(" ") : "No rule thresholds were triggered.";
  const qtyText =
    suggestedQty === null ? "No quantity is proposed." : `Suggested quantity: ${suggestedQty} (planner approval required).`;

  return {
    ...base,
    coverageWeeks,
    flags,
    action,
    suggestedQty,
    requiresManualReview: suggestedQty === null,
    warnings,
    explanation: `${ACTION_LABELS[action]}. ${flagText} ${qtyText}`,
  };
}
