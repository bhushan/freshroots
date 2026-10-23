const WEEK_PATTERN = /^(\d{4})-W(\d{2})$/;
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/** Monday of ISO week 1 for the given ISO year (week 1 always contains Jan 4). */
function week1Monday(isoYear: number): number {
  const jan4 = Date.UTC(isoYear, 0, 4);
  const dayOfWeek = new Date(jan4).getUTCDay() || 7; // Mon=1 .. Sun=7
  return jan4 - (dayOfWeek - 1) * 24 * 60 * 60 * 1000;
}

export function isoWeeksInYear(isoYear: number): number {
  return Math.round((week1Monday(isoYear + 1) - week1Monday(isoYear)) / MS_PER_WEEK);
}

/** Parses "YYYY-Www"; returns null for malformed or non-existent weeks. */
export function parseIsoWeek(value: string): { isoYear: number; isoWeek: number } | null {
  const match = WEEK_PATTERN.exec(value);
  if (!match) return null;
  const isoYear = Number(match[1]);
  const isoWeek = Number(match[2]);
  if (isoWeek < 1 || isoWeek > isoWeeksInYear(isoYear)) return null;
  return { isoYear, isoWeek };
}

export function formatIsoWeek(isoYear: number, isoWeek: number): string {
  return `${isoYear}-W${String(isoWeek).padStart(2, "0")}`;
}

/** A number that increases by exactly 1 per ISO week, across year boundaries. */
export function isoWeekOrdinal(isoYear: number, isoWeek: number): number {
  return Math.round((week1Monday(isoYear) + (isoWeek - 1) * MS_PER_WEEK) / MS_PER_WEEK);
}
