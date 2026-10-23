/** Display formatting shared by server and client components. */

const nf0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const NA = "n/a";

export const fmtInt = (n: number | null | undefined) => (n === null || n === undefined ? NA : nf0.format(n));
export const fmtAvg = (n: number | null | undefined) => (n === null || n === undefined ? NA : nf1.format(n));
export const fmtDecimal = (n: number | null | undefined) => (n === null || n === undefined ? NA : nf2.format(n));
export const fmtWeeks = (n: number | null | undefined) => (n === null || n === undefined ? NA : `${nf1.format(n)} wk`);

/** "2026-10-19" -> "19 Oct 2026" (date-only strings are not timezone shifted). */
export function fmtDate(value: string | null | undefined): string {
  if (!value) return NA;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Instants are shown in IST, the planner's timezone. */
export function fmtDateTime(value: string | Date | null | undefined): string {
  if (!value) return NA;
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return NA;
  return `${d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  })} IST`;
}
