import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import * as t from "@/db/schema";
import type { Db, Store } from "@/db/store";
import {
  validateDataset,
  type DatasetName,
  type DatasetRows,
  type RefData,
  type ValidationReport,
} from "@/lib/csv/validate";
import { formatIsoWeek } from "@/lib/iso-week";

const CHUNK = 500;

/** Datasets must load in this order so references can be validated. */
export const DATASET_ORDER: DatasetName[] = ["distributors", "calendar", "skus", "weekly_sales", "inventory"];

export interface ImportResult<N extends DatasetName> {
  status: "imported" | "rejected";
  report: ValidationReport<DatasetRows[N]>;
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text.replace(/\r\n/g, "\n").trim()).digest("hex");
}

export async function loadRefs(db: Db): Promise<RefData> {
  const [skuRows, distRows] = await Promise.all([
    db.select({ id: t.skus.skuId }).from(t.skus),
    db.select({ id: t.distributors.distributorId }).from(t.distributors),
  ]);
  return { skuIds: new Set(skuRows.map((r) => r.id)), distributorIds: new Set(distRows.map((r) => r.id)) };
}

async function insertChunked<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += CHUNK) await insert(rows.slice(i, i + CHUNK));
}

const excluded = (column: string) => sql.raw(`excluded."${column}"`);

/**
 * Validates first, then upserts everything in one transaction. Any rejected row blocks the
 * whole file, so a bad upload can never overwrite good data.
 */
export async function importDataset<N extends DatasetName>(
  store: Store,
  name: N,
  csvText: string,
): Promise<ImportResult<N>> {
  const refs = await loadRefs(store.db);
  const report = validateDataset(name, csvText, refs);
  if (!report.ok) return { status: "rejected", report };

  const hash = contentHash(csvText);
  await store.tx(async (tx) => {
    const latestDate = await upsert(tx, name, report.accepted as DatasetRows[DatasetName][]);
    await tx.insert(t.importBatches).values({
      dataset: name,
      contentHash: hash,
      rowCount: report.accepted.length,
      latestDate,
    });
  });
  return { status: "imported", report };
}

/** Writes rows with ON CONFLICT upserts and returns the dataset's latest date label. */
async function upsert(tx: Db, name: DatasetName, rows: DatasetRows[DatasetName][]): Promise<string | null> {
  switch (name) {
    case "distributors": {
      const data = rows as DatasetRows["distributors"][];
      await insertChunked(data, (chunk) =>
        tx
          .insert(t.distributors)
          .values(chunk)
          .onConflictDoUpdate({
            target: t.distributors.distributorId,
            set: { name: excluded("name"), region: excluded("region"), status: excluded("status"), updatedAt: sql`now()` },
          }),
      );
      return null;
    }
    case "calendar": {
      const data = rows as DatasetRows["calendar"][];
      await insertChunked(data, (chunk) =>
        tx
          .insert(t.calendarMonths)
          .values(chunk)
          .onConflictDoUpdate({
            target: t.calendarMonths.yearMonth,
            set: { year: excluded("year"), month: excluded("month"), isFestivalMonth: excluded("is_festival_month") },
          }),
      );
      return data.map((r) => r.yearMonth).sort().at(-1) ?? null;
    }
    case "skus": {
      const data = rows as DatasetRows["skus"][];
      await insertChunked(data, (chunk) =>
        tx
          .insert(t.skus)
          .values(chunk)
          .onConflictDoUpdate({
            target: t.skus.skuId,
            set: {
              name: excluded("name"),
              category: excluded("category"),
              perishability: excluded("perishability"),
              standardReorderQty: excluded("standard_reorder_qty"),
              unitOfMeasure: excluded("unit_of_measure"),
              distributorId: excluded("distributor_id"),
              updatedAt: sql`now()`,
            },
          }),
      );
      return null;
    }
    case "weekly_sales": {
      const data = rows as DatasetRows["weekly_sales"][];
      await insertChunked(data, (chunk) =>
        tx
          .insert(t.weeklySales)
          .values(chunk)
          .onConflictDoUpdate({
            target: [t.weeklySales.skuId, t.weeklySales.isoYear, t.weeklySales.isoWeek],
            set: { unitsSold: excluded("units_sold"), updatedAt: sql`now()` },
          }),
      );
      const latest = [...data].sort((a, b) => a.isoYear - b.isoYear || a.isoWeek - b.isoWeek).at(-1);
      return latest ? formatIsoWeek(latest.isoYear, latest.isoWeek) : null;
    }
    case "inventory": {
      const data = rows as DatasetRows["inventory"][];
      const groups = new Map<string, DatasetRows["inventory"][]>();
      for (const r of data) {
        const key = `${r.location}|${r.asOfDate}`;
        groups.set(key, [...(groups.get(key) ?? []), r]);
      }
      for (const group of groups.values()) {
        const [snapshot] = await tx
          .insert(t.inventorySnapshots)
          .values({ location: group[0].location, asOfDate: group[0].asOfDate })
          .onConflictDoUpdate({
            target: [t.inventorySnapshots.location, t.inventorySnapshots.asOfDate],
            set: { location: excluded("location") },
          })
          .returning({ id: t.inventorySnapshots.id });
        await insertChunked(group, (chunk) =>
          tx
            .insert(t.inventoryItems)
            .values(chunk.map((r) => ({ snapshotId: snapshot.id, skuId: r.skuId, unitsOnHand: r.unitsOnHand })))
            .onConflictDoUpdate({
              target: [t.inventoryItems.snapshotId, t.inventoryItems.skuId],
              set: { unitsOnHand: excluded("units_on_hand"), updatedAt: sql`now()` },
            }),
        );
      }
      return data.map((r) => r.asOfDate).sort().at(-1) ?? null;
    }
  }
}

export interface SampleFile {
  dataset: DatasetName;
  name: string;
  text: string;
}

/** Drops files whose content is byte-for-byte (modulo line endings) identical to an earlier file. */
export function dedupeFilesByContent(files: SampleFile[]): { unique: SampleFile[]; skipped: SampleFile[] } {
  const seen = new Set<string>();
  const unique: SampleFile[] = [];
  const skipped: SampleFile[] = [];
  for (const file of files) {
    const key = `${file.dataset}:${contentHash(file.text)}`;
    if (seen.has(key)) skipped.push(file);
    else {
      seen.add(key);
      unique.push(file);
    }
  }
  return { unique, skipped };
}

export interface LoadResult {
  dataset: DatasetName;
  name: string;
  status: "imported" | "rejected" | "skipped-duplicate-file";
  report?: ValidationReport<unknown>;
}

/** Loads a set of files in dependency order, importing duplicate copies only once. */
export async function loadSampleData(store: Store, files: SampleFile[]): Promise<LoadResult[]> {
  const { unique, skipped } = dedupeFilesByContent(files);
  const ordered = [...unique].sort((a, b) => DATASET_ORDER.indexOf(a.dataset) - DATASET_ORDER.indexOf(b.dataset));
  const results: LoadResult[] = [];
  for (const file of ordered) {
    const { status, report } = await importDataset(store, file.dataset, file.text);
    results.push({ dataset: file.dataset, name: file.name, status, report: report as ValidationReport<unknown> });
    if (status === "rejected") break; // later datasets depend on earlier ones
  }
  for (const file of skipped) {
    results.push({ dataset: file.dataset, name: file.name, status: "skipped-duplicate-file" });
  }
  return results;
}
