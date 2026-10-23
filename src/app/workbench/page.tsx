import { EmptyState, SetupNeeded } from "@/components/notice";
import { WorkbenchTable } from "@/components/workbench-table";
import { getStore, isDatabaseConfigured } from "@/db/client";
import { fmtDate } from "@/lib/format";
import { getRecRows, getRunInfo } from "@/lib/queries";

export const metadata = { title: "Workbench" };

export default async function WorkbenchPage({ searchParams }: { searchParams: Promise<{ flag?: string }> }) {
  if (!isDatabaseConfigured()) return <SetupNeeded reason="no-database" />;
  const { flag } = await searchParams;
  let data;
  try {
    const { db } = getStore();
    const run = await getRunInfo(db);
    data = { run, rows: run ? await getRecRows(db, run.id) : [] };
  } catch {
    return <SetupNeeded reason="error" />;
  }
  if (!data.run) {
    return (
      <div className="space-y-6">
        <h1 className="type-title">Demand planning workbench</h1>
        <EmptyState title="No analysis yet">Load the sample data and run the analysis from the Overview page to see SKUs here.</EmptyState>
      </div>
    );
  }
  return (
    <div className="space-y-8">
      <div>
        <p className="type-label text-ash">Snapshot {fmtDate(data.run.snapshotDate)}</p>
        <h1 className="type-title mt-3">Demand planning workbench</h1>
        <p className="mt-3 max-w-prose text-base text-ash">Every SKU with its sales averages, stock cover and proposed action. Open a row to see the rules behind it.</p>
      </div>
      <WorkbenchTable rows={data.rows} initialFlag={flag} />
    </div>
  );
}
