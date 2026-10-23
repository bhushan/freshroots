/**
 * Prints row counts and integrity checks for the loaded data, so you can confirm an import
 * was loaded once and not double-counted.
 *
 *   npm run db:verify
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });
config();

const EXPECTED: Record<string, number> = {
  distributors: 4,
  skus: 15,
  calendar_months: 24,
  weekly_sales: 240,
  inventory_snapshots: 1,
  inventory_items: 15,
};

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const sql = neon(process.env.DATABASE_URL);
  const count = async (table: string) => ((await sql.query(`select count(*)::int as n from ${table}`)) as { n: number }[])[0].n;

  let ok = true;
  console.log("Table                 Rows  Expected for the supplied sample");
  for (const [table, expected] of Object.entries(EXPECTED)) {
    const n = await count(table);
    const match = n === expected;
    ok &&= match;
    console.log(`${table.padEnd(20)} ${String(n).padStart(5)}  ${expected} ${match ? "ok" : "MISMATCH"}`);
  }
  for (const table of ["analysis_runs", "recommendations", "review_actions", "import_batches", "ai_usage"]) {
    console.log(`${table.padEnd(20)} ${String(await count(table)).padStart(5)}  (grows with use)`);
  }

  const dupes = (await sql.query(
    "select count(*)::int as n from (select 1 from weekly_sales group by sku_id, iso_year, iso_week having count(*) > 1) d",
  )) as { n: number }[];
  console.log(`Duplicate SKU/week groups: ${dupes[0].n}`);
  ok &&= dupes[0].n === 0;

  if (!ok) {
    console.error("Verification failed.");
    process.exit(1);
  }
  console.log("Verification passed.");
}

main().catch((err) => {
  console.error(`Verify failed: ${err instanceof Error ? err.message : "unknown error"}`);
  process.exit(1);
});
