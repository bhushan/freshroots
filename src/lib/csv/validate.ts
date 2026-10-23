import Papa from "papaparse";
import { parseIsoWeek } from "@/lib/iso-week";

export type DatasetName = "distributors" | "calendar" | "skus" | "weekly_sales" | "inventory";

export interface DistributorRow {
  distributorId: string;
  name: string;
  region: string;
  status: string;
}
export interface CalendarRow {
  year: number;
  month: number;
  yearMonth: string;
  isFestivalMonth: boolean;
}
export interface SkuRow {
  skuId: string;
  name: string;
  category: string;
  perishability: "Low" | "High";
  standardReorderQty: number;
  unitOfMeasure: string;
  distributorId: string;
}
export interface SalesRow {
  skuId: string;
  isoYear: number;
  isoWeek: number;
  unitsSold: number;
}
export interface InventoryRow {
  skuId: string;
  location: string;
  unitsOnHand: number;
  asOfDate: string;
}

export interface DatasetRows {
  distributors: DistributorRow;
  calendar: CalendarRow;
  skus: SkuRow;
  weekly_sales: SalesRow;
  inventory: InventoryRow;
}

/** Records already known (database or earlier files in the same load) for reference checks. */
export interface RefData {
  skuIds: Set<string>;
  distributorIds: Set<string>;
}

export interface RowIssue {
  /** 1-based data row number (header excluded); 0 for file-level problems. */
  row: number;
  message: string;
}

export interface ValidationReport<T> {
  dataset: DatasetName;
  /** True only when nothing was rejected and the header is exact. Imports require this. */
  ok: boolean;
  totalRows: number;
  accepted: T[];
  rejected: { row: number; reason: string }[];
  duplicates: { row: number; key: string; identical: boolean }[];
  errors: RowIssue[];
  /** First raw rows, for the preview table. */
  preview: Record<string, string>[];
}

const PREVIEW_ROWS = 10;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

type Raw = Record<string, string>;
type Parsed<T> = { row: T } | { error: string };

interface Spec<T> {
  columns: string[];
  parse(raw: Raw, refs: RefData): Parsed<T>;
  key(row: T): string;
}

function text(raw: Raw, col: string): { value: string } | { error: string } {
  const value = (raw[col] ?? "").trim();
  if (value === "") return { error: `${col} is required` };
  if (CONTROL_CHARS.test(value)) return { error: `${col} contains control characters` };
  return { value };
}

function wholeNumber(raw: Raw, col: string, min: number): { value: number } | { error: string } {
  const value = (raw[col] ?? "").trim();
  if (value === "") return { error: `${col} is required` };
  if (/^-\d+$/.test(value)) return { error: `${col} must not be negative (got ${value})` };
  if (!/^\d+$/.test(value)) return { error: `${col} must be a whole number (got "${value}")` };
  const n = Number(value);
  if (!Number.isSafeInteger(n)) return { error: `${col} is too large` };
  if (n < min) return { error: `${col} must be at least ${min} (got ${value})` };
  return { value: n };
}

function isRealDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Returns the first field error among the parsed fields, or null when all are valid. */
function first(...results: object[]): { error: string } | null {
  for (const r of results) if ("error" in r) return r as { error: string };
  return null;
}

const SPECS: { [N in DatasetName]: Spec<DatasetRows[N]> } = {
  distributors: {
    columns: ["Distributor_ID", "Distributor_Name", "Region", "Status"],
    parse(raw) {
      const id = text(raw, "Distributor_ID");
      const name = text(raw, "Distributor_Name");
      const region = text(raw, "Region");
      const status = text(raw, "Status");
      const err = first(id, name, region, status);
      if (err) return err;
      return {
        row: {
          distributorId: (id as { value: string }).value,
          name: (name as { value: string }).value,
          region: (region as { value: string }).value,
          status: (status as { value: string }).value,
        },
      };
    },
    key: (r) => r.distributorId,
  },

  calendar: {
    columns: ["Year", "Month", "Year_Month", "Is_Festival_Month"],
    parse(raw) {
      const year = wholeNumber(raw, "Year", 1900);
      const month = wholeNumber(raw, "Month", 1);
      const ym = text(raw, "Year_Month");
      const fest = text(raw, "Is_Festival_Month");
      const err = first(year, month, ym, fest);
      if (err) return err;
      const y = (year as { value: number }).value;
      const m = (month as { value: number }).value;
      const yearMonth = (ym as { value: string }).value;
      const flag = (fest as { value: string }).value.toUpperCase();
      if (m > 12) return { error: `Month must be between 1 and 12 (got ${m})` };
      const expected = `${y}-${String(m).padStart(2, "0")}`;
      if (yearMonth !== expected) return { error: `Year_Month ${yearMonth} does not match Year and Month (${expected})` };
      if (flag !== "TRUE" && flag !== "FALSE") return { error: `Is_Festival_Month must be TRUE or FALSE (got "${flag}")` };
      return { row: { year: y, month: m, yearMonth, isFestivalMonth: flag === "TRUE" } };
    },
    key: (r) => r.yearMonth,
  },

  skus: {
    columns: ["SKU_ID", "SKU_Name", "Category", "Perishability", "Standard_Reorder_Qty", "Unit_of_Measure", "Distributor_ID"],
    parse(raw, refs) {
      const id = text(raw, "SKU_ID");
      const name = text(raw, "SKU_Name");
      const category = text(raw, "Category");
      const per = text(raw, "Perishability");
      const qty = wholeNumber(raw, "Standard_Reorder_Qty", 1);
      const uom = text(raw, "Unit_of_Measure");
      const dist = text(raw, "Distributor_ID");
      const err = first(id, name, category, per, qty, uom, dist);
      if (err) return err;
      const perishability = (per as { value: string }).value;
      if (perishability !== "Low" && perishability !== "High") {
        return { error: `Perishability must be Low or High (got "${perishability}")` };
      }
      const distributorId = (dist as { value: string }).value;
      if (!refs.distributorIds.has(distributorId)) return { error: `Unknown Distributor_ID ${distributorId}` };
      return {
        row: {
          skuId: (id as { value: string }).value,
          name: (name as { value: string }).value,
          category: (category as { value: string }).value,
          perishability,
          standardReorderQty: (qty as { value: number }).value,
          unitOfMeasure: (uom as { value: string }).value,
          distributorId,
        },
      };
    },
    key: (r) => r.skuId,
  },

  weekly_sales: {
    columns: ["SKU_ID", "Week", "Units_Sold"],
    parse(raw, refs) {
      const id = text(raw, "SKU_ID");
      const week = text(raw, "Week");
      const units = wholeNumber(raw, "Units_Sold", 0);
      const err = first(id, week, units);
      if (err) return err;
      const skuId = (id as { value: string }).value;
      const weekValue = (week as { value: string }).value;
      const parsed = parseIsoWeek(weekValue);
      if (!parsed) return { error: `Week "${weekValue}" is not a valid ISO week (expected YYYY-Www, e.g. 2026-W27)` };
      if (!refs.skuIds.has(skuId)) return { error: `Unknown SKU_ID ${skuId}` };
      return { row: { skuId, ...parsed, unitsSold: (units as { value: number }).value } };
    },
    key: (r) => `${r.skuId}|${r.isoYear}-W${r.isoWeek}`,
  },

  inventory: {
    columns: ["SKU_ID", "Location", "Units_On_Hand", "As_Of_Date"],
    parse(raw, refs) {
      const id = text(raw, "SKU_ID");
      const loc = text(raw, "Location");
      const units = wholeNumber(raw, "Units_On_Hand", 0);
      const date = text(raw, "As_Of_Date");
      const err = first(id, loc, units, date);
      if (err) return err;
      const skuId = (id as { value: string }).value;
      const asOfDate = (date as { value: string }).value;
      if (!isRealDate(asOfDate)) return { error: `As_Of_Date "${asOfDate}" is not a valid YYYY-MM-DD date` };
      if (!refs.skuIds.has(skuId)) return { error: `Unknown SKU_ID ${skuId}` };
      return {
        row: {
          skuId,
          location: (loc as { value: string }).value,
          unitsOnHand: (units as { value: number }).value,
          asOfDate,
        },
      };
    },
    key: (r) => `${r.skuId}|${r.location}|${r.asOfDate}`,
  },
};

export function datasetColumns(name: DatasetName): string[] {
  return SPECS[name].columns;
}

export function validateDataset<N extends DatasetName>(
  name: N,
  csvText: string,
  refs: RefData,
): ValidationReport<DatasetRows[N]> {
  const spec = SPECS[name] as Spec<DatasetRows[N]>;
  const report: ValidationReport<DatasetRows[N]> = {
    dataset: name,
    ok: false,
    totalRows: 0,
    accepted: [],
    rejected: [],
    duplicates: [],
    errors: [],
    preview: [],
  };

  const body = csvText.replace(/^﻿/, "");
  if (body.trim() === "") {
    report.errors.push({ row: 0, message: "The file is empty" });
    return report;
  }

  const parsed = Papa.parse<Raw>(body, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
  const headers = parsed.meta.fields ?? [];
  const missing = spec.columns.filter((c) => !headers.includes(c));
  const extra = headers.filter((h) => !spec.columns.includes(h));
  if (missing.length || extra.length) {
    if (missing.length) report.errors.push({ row: 0, message: `Missing required column(s): ${missing.join(", ")}` });
    if (extra.length) report.errors.push({ row: 0, message: `Unexpected column(s): ${extra.join(", ")}` });
    return report;
  }

  report.totalRows = parsed.data.length;
  report.preview = parsed.data.slice(0, PREVIEW_ROWS);

  const seen = new Map<string, DatasetRows[N]>();
  parsed.data.forEach((raw, index) => {
    const rowNumber = index + 1;
    if (Object.keys(raw).length > spec.columns.length || (raw as Record<string, unknown>)["__parsed_extra"]) {
      report.rejected.push({ row: rowNumber, reason: "Row has more fields than the header" });
      report.errors.push({ row: rowNumber, message: "Row has more fields than the header" });
      return;
    }
    const result = spec.parse(raw, refs);
    if ("error" in result) {
      report.rejected.push({ row: rowNumber, reason: result.error });
      report.errors.push({ row: rowNumber, message: result.error });
      return;
    }
    const key = spec.key(result.row);
    const previous = seen.get(key);
    if (previous) {
      const identical = JSON.stringify(previous) === JSON.stringify(result.row);
      report.duplicates.push({ row: rowNumber, key, identical });
      if (!identical) {
        const reason = `Conflicting duplicate for ${key}: same key with different values`;
        report.rejected.push({ row: rowNumber, reason });
        report.errors.push({ row: rowNumber, message: reason });
      }
      return;
    }
    seen.set(key, result.row);
    report.accepted.push(result.row);
  });

  report.ok = report.errors.length === 0;
  return report;
}
