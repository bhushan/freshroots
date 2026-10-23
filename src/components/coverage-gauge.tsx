import { RULES } from "@/lib/rules/config";
import { fmtWeeks } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Weeks shown across the full width of the gauge. Anything beyond is pinned to the right edge. */
const SCALE_WEEKS = 20;

/**
 * Stock coverage against the thresholds that apply to this SKU's perishability class.
 * The lighter end zones are the risk ranges and the dark middle is normal. Band widths come
 * from RULES and the marker sits at the real coverage value; it turns blue when cover is outside normal.
 */
export function CoverageGauge({
  coverageWeeks,
  perishability,
  large = false,
  className,
}: {
  coverageWeeks: number | null;
  perishability: "Low" | "High";
  large?: boolean;
  className?: string;
}) {
  const { stockoutBelowWeeks: low, overstockAboveWeeks: high } = perishability === "High" ? RULES.highPerishability : RULES.ordinary;
  const pct = (weeks: number) => `${(Math.min(weeks, SCALE_WEEKS) / SCALE_WEEKS) * 100}%`;
  const outside = coverageWeeks !== null && (coverageWeeks < low || coverageWeeks > high);
  const label =
    coverageWeeks === null
      ? "Coverage not available"
      : `Stock covers ${fmtWeeks(coverageWeeks)}. Normal range is ${low} to ${high} weeks.`;

  return (
    <div className={cn("relative", large ? "h-9" : "h-4", className)} role="img" aria-label={label}>
      <div className={cn("absolute inset-x-0 flex overflow-hidden rounded-[2px]", large ? "top-0 h-4" : "top-1 h-2")}>
        <div className="bg-graphite" style={{ width: pct(low) }} />
        <div className="bg-carbon" style={{ width: `calc(${pct(high)} - ${pct(low)})` }} />
        <div className="flex-1 bg-graphite" />
      </div>
      {coverageWeeks !== null && (
        <div
          className={cn("absolute w-0.5 -translate-x-1/2", outside ? "bg-cornflower" : "bg-snow", large ? "top-[-3px] h-[22px]" : "top-0 h-4")}
          style={{ left: pct(coverageWeeks) }}
        />
      )}
      {large && (
        <>
          <span className="absolute top-6 -translate-x-1/2 text-xs text-ash" style={{ left: pct(low) }}>
            {low} wk
          </span>
          <span className="absolute top-6 -translate-x-1/2 text-xs text-ash" style={{ left: pct(high) }}>
            {high} wk
          </span>
        </>
      )}
    </div>
  );
}
