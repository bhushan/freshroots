/**
 * Builds Zoho Books import files from the supplied masters, so a fresh Zoho organisation starts out matching
 * this database. Output: data/zoho/vendors.csv and data/zoho/items.csv. Reads no credentials and calls no API.
 * Prices do not exist in the source data, so every rate is a placeholder to correct in Zoho.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import Papa from "papaparse";

const root = path.join(import.meta.dirname, "..");
const read = (f: string) => Papa.parse<Record<string, string>>(readFileSync(path.join(root, "data/sample", f), "utf8"), { header: true, skipEmptyLines: true }).data;

const PLACEHOLDER_RATE = 1;
const distributors = read("distributor_master.csv");
const skus = read("sku_master.csv");
const vendorName = new Map(distributors.map((d) => [d.Distributor_ID, d.Distributor_Name]));

writeFileSync(
  path.join(root, "data/zoho/vendors.csv"),
  Papa.unparse(distributors.map((d) => ({ "Display Name": d.Distributor_Name, "Company Name": d.Distributor_Name, "Billing State": d.Region, Status: d.Status })), { newline: "\n" }) + "\n",
);

writeFileSync(
  path.join(root, "data/zoho/items.csv"),
  Papa.unparse(
    skus.map((s) => ({
      "Item Name": s.SKU_Name,
      SKU: s.SKU_ID,
      "Usage unit": s.Unit_of_Measure,
      "Item Type": "Sales and Purchases",
      "Product Type": "goods",
      Status: "Active",
      Rate: PLACEHOLDER_RATE,
      "Purchase Rate": PLACEHOLDER_RATE,
      "Reorder Level": s.Standard_Reorder_Qty,
      "Preferred Vendor": vendorName.get(s.Distributor_ID) ?? "",
      Category: s.Category,
      Perishability: s.Perishability,
    })),
    { newline: "\n" },
  ) + "\n",
);
console.log(`vendors: ${distributors.length}, items: ${skus.length}`);
