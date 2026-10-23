import type { RuleFlag } from "@/lib/rules/engine";
import { RULES } from "@/lib/rules/config";

export const SYSTEM_INSTRUCTION = [
  "You explain the output of a deterministic demand-planning rule engine for a regional FMCG distributor.",
  "The rules, not you, decide every recommendation. Never change, correct, or second-guess a calculation, flag, action, or quantity.",
  "Use ONLY the facts in the JSON input. Do not invent inventory, prices, costs, forecast values, dates, suppliers, or financial impact.",
  "If something is not in the input, do not mention it. Do not estimate savings or ROI.",
  "Refer to SKUs by their SKU ID exactly as given. Never mention a SKU ID that is not in the input.",
  "Recommendations are proposals that a human planner must approve. Say so where relevant.",
  "Be concise and plain, suitable for a business dashboard. Do not use markdown. Return JSON matching the requested schema.",
].join("\n");

export interface SkuFacts {
  skuId: string;
  name: string;
  category: string;
  perishability: "Low" | "High";
  standardReorderQty: number;
  distinctWeeks: number;
  avg4WeekRaw: number | null;
  avg12WeekRaw: number | null;
  avg4WeekAdjusted: number | null;
  avg12WeekAdjusted: number | null;
  festivalUpliftApplied: boolean;
  unitsOnHand: number | null;
  stockCoverageWeeks: number | null;
  flags: Pick<RuleFlag, "code" | "rule" | "threshold" | "actual">[];
  recommendedAction: string;
  suggestedQuantity: number | null;
  warnings: string[];
}

export interface RunFacts {
  analysisMonth: string;
  festivalMonth: boolean;
  festivalUpliftPercent: number;
  inventorySnapshotDate: string;
  counts: Record<string, number>;
}

const round = (n: number | null, dp = 2) => (n === null ? null : Number(n.toFixed(dp)));

export function toSkuFacts(row: {
  skuId: string;
  name: string;
  category: string;
  perishability: string;
  standardReorderQty: number;
  distinctWeeks: number;
  avg4Raw: number | null;
  avg12Raw: number | null;
  avg4Adjusted: number | null;
  avg12Adjusted: number | null;
  festivalUpliftApplied: boolean;
  unitsOnHand: number | null;
  coverageWeeks: number | null;
  flags: RuleFlag[];
  action: string;
  suggestedQty: number | null;
  warnings: string[];
}): SkuFacts {
  return {
    skuId: row.skuId,
    name: row.name,
    category: row.category,
    perishability: row.perishability as "Low" | "High",
    standardReorderQty: row.standardReorderQty,
    distinctWeeks: row.distinctWeeks,
    avg4WeekRaw: round(row.avg4Raw),
    avg12WeekRaw: round(row.avg12Raw),
    avg4WeekAdjusted: round(row.avg4Adjusted),
    avg12WeekAdjusted: round(row.avg12Adjusted),
    festivalUpliftApplied: row.festivalUpliftApplied,
    unitsOnHand: row.unitsOnHand,
    stockCoverageWeeks: round(row.coverageWeeks),
    flags: row.flags.map(({ code, rule, threshold, actual }) => ({ code, rule, threshold, actual })),
    recommendedAction: row.action,
    suggestedQuantity: row.suggestedQty,
    warnings: row.warnings,
  };
}

export function runFacts(run: { analysisMonth: string; festivalMonth: boolean; snapshotDate: string }, counts: Record<string, number>): RunFacts {
  return {
    analysisMonth: run.analysisMonth,
    festivalMonth: run.festivalMonth,
    festivalUpliftPercent: Math.round((RULES.festivalUplift - 1) * 100),
    inventorySnapshotDate: run.snapshotDate,
    counts,
  };
}

export function summaryPrompt(run: RunFacts, skus: SkuFacts[]): string {
  return [
    "Task: write an operational summary of this analysis run for a demand planner.",
    "Return a one-sentence headline, 3 to 6 short bullets covering the most important required actions, and the SKU IDs most worth watching.",
    "Mention that figures reflect the inventory snapshot date, not live stock.",
    "",
    "Input (JSON):",
    JSON.stringify({ run, skus }),
  ].join("\n");
}

export function explainPrompt(run: RunFacts, sku: SkuFacts): string {
  return [
    `Task: explain, for a planner, why ${sku.skuId} received its recommendation.`,
    "Return a short summary, up to 5 drivers that cite the numbers and thresholds given, and any caveats (data warnings, festival uplift, manual review) that are present in the input.",
    "",
    "Input (JSON):",
    JSON.stringify({ run, sku }),
  ].join("\n");
}
