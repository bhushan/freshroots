/**
 * One-time data load: reads the supplied sample CSVs from data/sample, validates them, and
 * upserts them into Neon in a single pass, then runs the first analysis.
 * Safe to re-run: upserts and unique constraints make it idempotent.
 *
 *   npm run db:seed
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import type { DatasetName } from "@/lib/csv/validate";

config({ path: ".env.local" });
config();

const DIR = path.join(process.cwd(), "data", "sample");
const FILES: { dataset: DatasetName; name: string }[] = [
  { dataset: "distributors", name: "distributor_master.csv" },
  { dataset: "distributors", name: "distributor_master (1).csv" },
  { dataset: "calendar", name: "calendar.csv" },
  { dataset: "skus", name: "sku_master.csv" },
  { dataset: "weekly_sales", name: "weekly_sales.csv" },
  { dataset: "inventory", name: "current_inventory.csv" },
];

async function main() {
  const [{ getStore }, { loadSampleData }, { runAnalysis }] = await Promise.all([
    import("@/db/client"),
    import("@/lib/import/commit"),
    import("@/lib/analysis/run"),
  ]);
  const store = getStore();

  const files = FILES.map((f) => ({ ...f, text: readFileSync(path.join(DIR, f.name), "utf8") }));
  const results = await loadSampleData(store, files);

  let failed = false;
  for (const r of results) {
    if (r.status === "skipped-duplicate-file") {
      console.log(`- ${r.name}: skipped (identical copy of another ${r.dataset} file)`);
    } else if (r.status === "rejected") {
      failed = true;
      console.error(`x ${r.name}: REJECTED, nothing written`);
      for (const e of r.report?.errors.slice(0, 10) ?? []) console.error(`    row ${e.row}: ${e.message}`);
    } else {
      const rep = r.report;
      console.log(`+ ${r.name}: ${rep?.accepted.length} rows imported, ${rep?.duplicates.length} duplicate rows ignored`);
    }
  }
  if (failed) process.exit(1);

  const run = await runAnalysis(store);
  if (!run.ok) {
    console.error(`Analysis not run: ${run.message}`);
    process.exit(1);
  }
  console.log(`Analysis complete (run ${run.runId}):`, JSON.stringify({ ...run.summary, warnings: undefined }));
}

main().catch((err) => {
  console.error(`Seed failed: ${err instanceof Error ? err.message : "unknown error"}`);
  process.exit(1);
});
