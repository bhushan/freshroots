import { describe, expect, it } from "vitest";
import { validateDataset, type RefData } from "@/lib/csv/validate";

const refs: RefData = {
  skuIds: new Set(["SKU001", "SKU002"]),
  distributorIds: new Set(["DIST001", "DIST002"]),
};

const sales = (...rows: string[]) => ["SKU_ID,Week,Units_Sold", ...rows].join("\n");
const msgs = (r: { errors: { message: string }[] }) => r.errors.map((e) => e.message).join(" | ");

describe("headers", () => {
  it("rejects a missing column", () => {
    const r = validateDataset("weekly_sales", "SKU_ID,Week\nSKU001,2026-W27", refs);
    expect(r.ok).toBe(false);
    expect(msgs(r)).toMatch(/Units_Sold/);
    expect(r.accepted).toEqual([]);
  });

  it("rejects an unexpected column", () => {
    const r = validateDataset("weekly_sales", "SKU_ID,Week,Units_Sold,Distributor_ID\nSKU001,2026-W27,5,DIST001", refs);
    expect(r.ok).toBe(false);
    expect(msgs(r)).toMatch(/Distributor_ID/);
  });

  it("tolerates a UTF-8 BOM and CRLF line endings", () => {
    const r = validateDataset("weekly_sales", "﻿SKU_ID,Week,Units_Sold\r\nSKU001,2026-W27,5\r\n", refs);
    expect(r.ok).toBe(true);
    expect(r.accepted).toHaveLength(1);
  });

  it("rejects an empty file", () => {
    expect(validateDataset("weekly_sales", "", refs).ok).toBe(false);
  });
});

describe("weekly_sales rows", () => {
  it("accepts valid rows", () => {
    const r = validateDataset("weekly_sales", sales("SKU001,2026-W27,194", "SKU002,2026-W27,0"), refs);
    expect(r.ok).toBe(true);
    expect(r.accepted).toEqual([
      { skuId: "SKU001", isoYear: 2026, isoWeek: 27, unitsSold: 194 },
      { skuId: "SKU002", isoYear: 2026, isoWeek: 27, unitsSold: 0 },
    ]);
  });

  it("rejects negative sales", () => {
    const r = validateDataset("weekly_sales", sales("SKU001,2026-W27,-4"), refs);
    expect(r.ok).toBe(false);
    expect(r.rejected).toHaveLength(1);
    expect(msgs(r)).toMatch(/negative/i);
  });

  it("rejects malformed and non-existent week identifiers", () => {
    for (const week of ["2026-27", "2026-W7", "2026-W54", "2025-W53", "W27"]) {
      const r = validateDataset("weekly_sales", sales(`SKU001,${week},5`), refs);
      expect(r.ok, week).toBe(false);
      expect(msgs(r), week).toMatch(/week/i);
    }
  });

  it("rejects missing required fields and non-integers", () => {
    expect(validateDataset("weekly_sales", sales("SKU001,2026-W27,"), refs).ok).toBe(false);
    expect(validateDataset("weekly_sales", sales(",2026-W27,5"), refs).ok).toBe(false);
    expect(validateDataset("weekly_sales", sales("SKU001,2026-W27,5.5"), refs).ok).toBe(false);
    expect(validateDataset("weekly_sales", sales("SKU001,2026-W27,abc"), refs).ok).toBe(false);
  });

  it("rejects an unknown SKU reference", () => {
    const r = validateDataset("weekly_sales", sales("SKU404,2026-W27,5"), refs);
    expect(r.ok).toBe(false);
    expect(msgs(r)).toMatch(/SKU404/);
  });

  it("reports an identical duplicate once and does not double-count it", () => {
    const r = validateDataset("weekly_sales", sales("SKU001,2026-W27,5", "SKU001,2026-W27,5"), refs);
    expect(r.accepted).toHaveLength(1);
    expect(r.duplicates).toHaveLength(1);
    expect(r.duplicates[0]).toMatchObject({ identical: true });
    expect(r.ok).toBe(true);
  });

  it("rejects a conflicting duplicate for the same SKU and week", () => {
    const r = validateDataset("weekly_sales", sales("SKU001,2026-W27,5", "SKU001,2026-W27,9"), refs);
    expect(r.ok).toBe(false);
    expect(r.duplicates[0]).toMatchObject({ identical: false });
    expect(msgs(r)).toMatch(/conflict/i);
  });

  it("keeps good rows visible when others fail, but the report is not ok", () => {
    const r = validateDataset("weekly_sales", sales("SKU001,2026-W27,5", "SKU001,2026-W28,-1"), refs);
    expect(r.accepted).toHaveLength(1);
    expect(r.rejected).toHaveLength(1);
    expect(r.ok).toBe(false);
  });
});

describe("sku_master rows", () => {
  const header = "SKU_ID,SKU_Name,Category,Perishability,Standard_Reorder_Qty,Unit_of_Measure,Distributor_ID";

  it("accepts a valid row", () => {
    const r = validateDataset("skus", `${header}\nSKU001,Mango,Beverage,Low,500,Units,DIST001`, refs);
    expect(r.ok).toBe(true);
    expect(r.accepted[0]).toMatchObject({ skuId: "SKU001", perishability: "Low", standardReorderQty: 500 });
  });

  it("rejects invalid reorder quantities", () => {
    for (const qty of ["0", "-5", "1.5", "abc", ""]) {
      const r = validateDataset("skus", `${header}\nSKU001,Mango,Beverage,Low,${qty},Units,DIST001`, refs);
      expect(r.ok, qty).toBe(false);
    }
  });

  it("rejects unknown perishability and unknown distributor", () => {
    expect(validateDataset("skus", `${header}\nSKU001,Mango,Beverage,Medium,5,Units,DIST001`, refs).ok).toBe(false);
    const r = validateDataset("skus", `${header}\nSKU001,Mango,Beverage,Low,5,Units,DIST999`, refs);
    expect(r.ok).toBe(false);
    expect(msgs(r)).toMatch(/DIST999/);
  });
});

describe("current_inventory rows", () => {
  const header = "SKU_ID,Location,Units_On_Hand,As_Of_Date";

  it("accepts a valid row", () => {
    const r = validateDataset("inventory", `${header}\nSKU001,Pune Central Warehouse,900,2026-10-19`, refs);
    expect(r.ok).toBe(true);
    expect(r.accepted[0]).toEqual({ skuId: "SKU001", location: "Pune Central Warehouse", unitsOnHand: 900, asOfDate: "2026-10-19" });
  });

  it("rejects negative inventory", () => {
    const r = validateDataset("inventory", `${header}\nSKU001,Pune,-1,2026-10-19`, refs);
    expect(r.ok).toBe(false);
    expect(msgs(r)).toMatch(/negative/i);
  });

  it("rejects invalid and impossible dates", () => {
    for (const d of ["2026-13-01", "2026-02-30", "19/10/2026", "2026-10-1", "", "not a date"]) {
      expect(validateDataset("inventory", `${header}\nSKU001,Pune,5,${d}`, refs).ok, d).toBe(false);
    }
  });

  it("rejects a duplicate SKU in the same location and date", () => {
    const r = validateDataset("inventory", `${header}\nSKU001,Pune,5,2026-10-19\nSKU001,Pune,6,2026-10-19`, refs);
    expect(r.ok).toBe(false);
  });
});

describe("distributor and calendar rows", () => {
  it("accepts distributors", () => {
    const r = validateDataset("distributors", "Distributor_ID,Distributor_Name,Region,Status\nDIST001,NutriFlow,Maharashtra,Active", refs);
    expect(r.ok).toBe(true);
  });

  it("validates calendar consistency and festival flag", () => {
    const header = "Year,Month,Year_Month,Is_Festival_Month";
    const good = validateDataset("calendar", `${header}\n2026,10,2026-10,TRUE\n2026,9,2026-09,FALSE`, refs);
    expect(good.ok).toBe(true);
    expect(good.accepted[0]).toEqual({ year: 2026, month: 10, yearMonth: "2026-10", isFestivalMonth: true });
    expect(validateDataset("calendar", `${header}\n2026,10,2026-11,TRUE`, refs).ok).toBe(false);
    expect(validateDataset("calendar", `${header}\n2026,13,2026-13,TRUE`, refs).ok).toBe(false);
    expect(validateDataset("calendar", `${header}\n2026,10,2026-10,maybe`, refs).ok).toBe(false);
  });
});

describe("preview and counts", () => {
  it("reports totals and a bounded preview", () => {
    const rows = Array.from({ length: 30 }, (_, i) => `SKU001,2026-W${String(i + 1).padStart(2, "0")},1`);
    const r = validateDataset("weekly_sales", sales(...rows), refs);
    expect(r.totalRows).toBe(30);
    expect(r.preview.length).toBeLessThanOrEqual(10);
  });
});
