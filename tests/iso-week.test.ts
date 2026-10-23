import { describe, expect, it } from "vitest";
import { isoWeeksInYear, isoWeekOrdinal, parseIsoWeek } from "@/lib/iso-week";

describe("parseIsoWeek", () => {
  it("parses a valid week", () => {
    expect(parseIsoWeek("2026-W27")).toEqual({ isoYear: 2026, isoWeek: 27 });
  });

  it("rejects malformed identifiers", () => {
    for (const bad of ["2026-27", "2026-W7", "26-W07", "2026-W00", "2026-W54", "", "2026-w27", " 2026-W27"]) {
      expect(parseIsoWeek(bad), bad).toBeNull();
    }
  });

  it("accepts W53 only in years that have 53 ISO weeks", () => {
    expect(isoWeeksInYear(2026)).toBe(53);
    expect(isoWeeksInYear(2025)).toBe(52);
    expect(parseIsoWeek("2026-W53")).not.toBeNull();
    expect(parseIsoWeek("2025-W53")).toBeNull();
  });
});

describe("isoWeekOrdinal", () => {
  it("is consecutive across year boundaries", () => {
    expect(isoWeekOrdinal(2026, 1) - isoWeekOrdinal(2025, 52)).toBe(1);
    expect(isoWeekOrdinal(2027, 1) - isoWeekOrdinal(2026, 53)).toBe(1);
  });

  it("increases by one per week", () => {
    expect(isoWeekOrdinal(2026, 42) - isoWeekOrdinal(2026, 27)).toBe(15);
  });
});
