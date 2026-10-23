import type { FlagCode } from "@/lib/rules/engine";

interface Prioritised {
  action: string;
  flags: { code: FlagCode }[];
}

export const isManual = (r: Prioritised) => r.action.startsWith("MANUAL_REVIEW");
export const hasFlag = (r: Prioritised, code: FlagCode) => r.flags.some((f) => f.code === code);

/** Higher = more urgent. Priority risks outrank informational states; 0 means no action proposed. */
export function priority(r: Prioritised): number {
  if (isManual(r)) return 5;
  if (hasFlag(r, "STOCKOUT_RISK")) return 4;
  if (hasFlag(r, "HIGH_DEMAND")) return 3;
  if (hasFlag(r, "OVERSTOCK_RISK")) return 2;
  if (hasFlag(r, "INSUFFICIENT_DATA")) return 1;
  return 0;
}
