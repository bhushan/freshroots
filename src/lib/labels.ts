import type { ReviewStatus } from "@/db/schema";
import type { ActionCode, FlagCode } from "@/lib/rules/engine";

/**
 * The design allows one chromatic accent, so risk is encoded by form as well as tone:
 * a solid white badge is the most urgent, a blue outline marks demand, dashed is overstock,
 * dotted is informational. Shape survives for colour-blind readers.
 */

export const FLAG_LABELS: Record<FlagCode, string> = {
  HIGH_DEMAND: "High Demand",
  STOCKOUT_RISK: "Stockout Risk",
  OVERSTOCK_RISK: "Overstock Risk",
  INSUFFICIENT_DATA: "Insufficient Data",
};

export const FLAG_STYLES: Record<FlagCode, string> = {
  STOCKOUT_RISK: "border-snow bg-snow text-ink",
  HIGH_DEMAND: "border-cornflower bg-cornflower/10 text-cornflower",
  OVERSTOCK_RISK: "border-dashed border-ash text-ash",
  INSUFFICIENT_DATA: "border-dotted border-fog text-fog",
};

export const ACTION_STYLES: Record<ActionCode, string> = {
  REORDER_HIGH_DEMAND: "text-cornflower",
  REORDER_IMMEDIATE: "text-snow",
  PAUSE_NEXT_ORDER: "text-ash",
  MANUAL_REVIEW_CONFLICT: "text-snow underline decoration-dotted underline-offset-4",
  MANUAL_REVIEW_INSUFFICIENT_DATA: "text-snow underline decoration-dotted underline-offset-4",
  MANUAL_REVIEW_MISSING_INVENTORY: "text-snow underline decoration-dotted underline-offset-4",
  MAINTAIN_MONITOR: "text-fog",
};

export const STATUS_LABELS: Record<ReviewStatus, string> = {
  pending: "Pending",
  investigating: "Investigating",
  approved: "Approved",
  rejected: "Rejected",
  overridden: "Overridden",
};

export const STATUS_STYLES: Record<ReviewStatus, string> = {
  pending: "border-graphite text-ash",
  investigating: "border-dashed border-snow text-snow",
  approved: "border-snow text-snow",
  rejected: "border-steel text-fog",
  overridden: "border-cornflower text-cornflower",
};

export const DATASET_LABELS: Record<string, string> = {
  distributors: "Distributors",
  calendar: "Calendar",
  skus: "SKU master",
  weekly_sales: "Weekly sales",
  inventory: "Current inventory",
};

export const ERROR_HINTS: Record<string, string> = {
  DEMO_READ_ONLY: "This deployment is a read-only demo.",
  UNAUTHENTICATED: "Sign in to make changes.",
};
