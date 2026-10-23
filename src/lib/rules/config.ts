/**
 * Every threshold from Raghav's documented forecasting rules lives here.
 * Nothing else in the codebase may hard-code these numbers.
 */
export const RULES = {
  /** Calendar months (1-12) the case treats as festival months. Fallback only; calendar_months is the source. */
  festivalMonths: [3, 10, 11],
  /** Step B: multiplier applied once to both averages in festival months. */
  festivalUplift: 1.25,

  /** Step A: observation windows, in distinct observed ISO weeks. */
  shortWindowWeeks: 4,
  longWindowWeeks: 12,

  /** Step C: High Demand when adjusted 4wk average > adjusted 12wk average x this ratio. */
  highDemandRatio: 1.2,
  /** Step C: suggested reorder = standard reorder quantity x this multiplier. */
  highDemandQtyMultiplier: 1.5,

  /** Steps D and E, ordinary SKUs (coverage in weeks of adjusted 12wk demand). */
  ordinary: { stockoutBelowWeeks: 6, overstockAboveWeeks: 14 },
  /** Step D, High-perishability SKUs. Between the two values is the normal range. */
  highPerishability: { stockoutBelowWeeks: 3, overstockAboveWeeks: 4 },

  /** Absolute tolerance so floating-point noise never flips a boundary comparison. */
  epsilon: 1e-9,
} as const;
