import Link from "next/link";
import { Boxes, DatabaseZap, Info, PackageX, ScanSearch, TrendingUp, TriangleAlert, Warehouse } from "lucide-react";
import { AiCard } from "@/components/ai-card";
import { AccessNotice, EmptyState, SetupNeeded } from "@/components/notice";
import { RiskChart, type RiskDatum } from "@/components/risk-chart";
import { RunAnalysisButton } from "@/components/run-analysis-button";
import { ZohoSyncButton } from "@/components/zoho-sync-button";
import { zohoConfigFromEnv } from "@/lib/zoho/client";
import { getStore, isDatabaseConfigured } from "@/db/client";
import { ACTION_STYLES, DATASET_LABELS } from "@/lib/labels";
import { fmtDate, fmtDateTime, fmtInt } from "@/lib/format";
import { getCachedSummary, getDataStatus, getRecRows, getRunInfo } from "@/lib/queries";
import { ACTION_LABELS, type ActionCode } from "@/lib/rules/engine";
import { getAccessMode } from "@/lib/server/context";
import { cn } from "@/lib/utils";

export const metadata = { title: "Overview" };

const REORDER_ACTIONS: ActionCode[] = ["REORDER_HIGH_DEMAND", "REORDER_IMMEDIATE"];
const ACTION_ORDER: ActionCode[] = [
  "MANUAL_REVIEW_CONFLICT",
  "MANUAL_REVIEW_MISSING_INVENTORY",
  "MANUAL_REVIEW_INSUFFICIENT_DATA",
  "REORDER_HIGH_DEMAND",
  "REORDER_IMMEDIATE",
  "PAUSE_NEXT_ORDER",
];

function PanelHeader({ id, title, note, action }: { id: string; title: string; note?: string; action?: React.ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
      <div>
        <h2 id={id} className="type-panel">
          {title}
        </h2>
        {note && <p className="mt-0.5 text-sm text-ash">{note}</p>}
      </div>
      {action}
    </header>
  );
}

export default async function OverviewPage() {
  if (!isDatabaseConfigured()) return <SetupNeeded reason="no-database" />;

  const mode = await getAccessMode();
  const canAct = mode === "admin";
  let data;
  try {
    const { db } = getStore();
    const [run, status] = await Promise.all([getRunInfo(db), getDataStatus(db)]);
    const [rows, summary] = run ? await Promise.all([getRecRows(db, run.id), getCachedSummary(db, run.id)]) : [[], null];
    data = { run, status, rows, summary };
  } catch {
    return <SetupNeeded reason="error" />;
  }
  const { run, status, rows, summary } = data;
  const hasData = status.some((s) => s.dataset === "skus" && s.rows > 0) && status.some((s) => s.dataset === "inventory" && s.rows > 0);

  if (!run) {
    return (
      <div className="space-y-6">
        <h1 className="type-title">Overview</h1>
        <EmptyState
          title={hasData ? "Ready to run the first analysis" : "No data loaded yet"}
          action={hasData ? <RunAnalysisButton enabled={canAct} label="Run analysis" /> : undefined}
        >
          {hasData ? (
            <>The sample data is loaded. Run the analysis to see risks and recommendations.</>
          ) : (
            <>
              Load the supplied sample files once with <code className="rounded-[4px] bg-carbon px-1.5 font-mono text-xs">npm run db:seed</code>. The README explains each step.
            </>
          )}
        </EmptyState>
        <AccessNotice mode={mode} what="run the analysis" />
      </div>
    );
  }

  const s = run.summary;
  const noFlag = rows.filter((r) => r.flags.length === 0 && !r.action.startsWith("MANUAL_REVIEW")).length;
  const chart: RiskDatum[] = [
    { name: "High Demand", value: s.highDemand, color: "#6798ff" },
    { name: "Stockout Risk", value: s.stockoutRisk, color: "#ffffff" },
    { name: "Overstock Risk", value: s.overstockRisk, color: "#a7a7a7" },
    { name: "Manual review", value: s.manualReview, color: "#7c7c7c" },
    { name: "Insufficient data", value: s.insufficientData, color: "#545454" },
    { name: "No risk flag", value: noFlag, color: "#313131" },
  ];

  const kpis = [
    { label: "SKUs analysed", value: s.totalSkus, href: "/workbench", icon: Boxes },
    { label: "High Demand", value: s.highDemand, href: "/workbench?flag=HIGH_DEMAND", icon: TrendingUp },
    { label: "Stockout Risk", value: s.stockoutRisk, href: "/workbench?flag=STOCKOUT_RISK", icon: PackageX },
    { label: "Overstock Risk", value: s.overstockRisk, href: "/workbench?flag=OVERSTOCK_RISK", icon: Warehouse },
    { label: "Manual review", value: s.manualReview, href: "/workbench?flag=MANUAL_REVIEW", icon: ScanSearch },
    { label: "Insufficient data", value: s.insufficientData, href: "/workbench?flag=INSUFFICIENT_DATA", icon: DatabaseZap },
  ];

  const groups = ACTION_ORDER.map((action) => ({ action, items: rows.filter((r) => r.action === action) })).filter((g) => g.items.length > 0);
  const maintain = rows.filter((r) => r.action === "MAINTAIN_MONITOR").length;
  const upliftPct = Math.round((run.festivalUplift - 1) * 100);

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="type-label text-ash">Snapshot {fmtDate(run.snapshotDate)}</p>
          <h1 className="type-title mt-3">Overview</h1>
          <p className="mt-3 text-base text-ash">Last analysis {fmtDateTime(run.createdAt)}.</p>
        </div>
        <div className="flex flex-wrap items-start gap-4">
          <ZohoSyncButton enabled={canAct} connected={zohoConfigFromEnv(process.env) !== null} />
          <RunAnalysisButton enabled={canAct} />
        </div>
      </div>
      <AccessNotice mode={mode} what="re-run the analysis" />

      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map(({ label, value, href, icon: Icon }) => (
          <Link key={label} href={href} className="group rounded-lg border border-transparent bg-carbon p-5 transition-colors hover:border-graphite">
            <Icon className="size-4 text-cornflower" strokeWidth={1.75} aria-hidden />
            <p className="type-stat mt-4">{fmtInt(value)}</p>
            <p className="mt-1 text-sm text-ash">{label}</p>
          </Link>
        ))}
      </section>

      <div className="flex items-start gap-3 rounded-lg border border-border bg-card px-5 py-4 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-cornflower" strokeWidth={1.75} aria-hidden />
        <p className="text-ash">
          {run.festivalMonth ? (
            <>
              <strong className="font-medium text-snow">{run.analysisMonth} is a festival month.</strong> A {upliftPct}% uplift was applied once to both sales averages before any threshold was checked. Raw and adjusted figures sit side by side in the workbench.
            </>
          ) : (
            <>
              <strong className="font-medium text-snow">{run.analysisMonth} is not a festival month.</strong> No uplift was applied.
            </>
          )}
        </p>
      </div>

      {s.warnings.length > 0 && (
        <ul className="space-y-1.5 rounded-lg border border-graphite bg-carbon px-5 py-4 text-sm text-ash">
          {s.warnings.map((w, i) => (
            <li key={i} className="flex gap-2.5">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-snow" strokeWidth={1.75} aria-hidden />
              {w}
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="rounded-lg border border-border bg-card lg:col-span-2" aria-labelledby="risk-heading">
          <PanelHeader id="risk-heading" title="Risk distribution" note="SKUs per state. One SKU can carry more than one flag." />
          <div className="px-3 py-4">
            <RiskChart data={chart} />
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card lg:col-span-3" aria-labelledby="actions-heading">
          <PanelHeader
            id="actions-heading"
            title="Actions to review"
            action={
              <Link href="/review" className="text-sm font-medium text-snow underline decoration-graphite underline-offset-4 hover:decoration-snow">
                Open review queue
              </Link>
            }
          />
          {groups.length === 0 ? (
            <p className="px-5 py-8 text-sm text-ash">No SKU needs action. All {maintain} are within their normal ranges.</p>
          ) : (
            <ul className="divide-y divide-border">
              {groups.map(({ action, items }) => {
                const units = REORDER_ACTIONS.includes(action) ? items.reduce((sum, r) => sum + (r.suggestedQty ?? 0), 0) : null;
                return (
                  <li key={action} className="px-5 py-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className={cn("text-sm font-medium", ACTION_STYLES[action])}>
                        {ACTION_LABELS[action]} <span className="font-normal text-ash">({items.length})</span>
                      </p>
                      {units !== null && <p className="text-xs text-ash">{fmtInt(units)} units proposed, before planner review</p>}
                    </div>
                    <p className="mt-2.5 flex flex-wrap gap-1.5">
                      {items.map((r) => (
                        <Link key={r.skuId} href={`/sku/${r.skuId}`} className="rounded-[4px] border border-steel px-2 py-0.5 text-xs font-medium text-snow hover:bg-carbon" title={r.skuName}>
                          {r.skuId}
                          {r.suggestedQty !== null && r.suggestedQty > 0 && <span className="ml-1.5 font-normal text-ash">{fmtInt(r.suggestedQty)}</span>}
                        </Link>
                      ))}
                    </p>
                  </li>
                );
              })}
              {maintain > 0 && (
                <li className="px-5 py-4 text-sm text-ash">
                  <span className="font-medium text-fog">{ACTION_LABELS.MAINTAIN_MONITOR}</span> ({maintain}). No action proposed.
                </li>
              )}
            </ul>
          )}
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <AiCard kind="summary" initial={summary} canGenerate={canAct} />
        </div>
        <section className="self-start rounded-lg border border-border bg-card lg:col-span-2" aria-labelledby="impact-heading">
          <PanelHeader id="impact-heading" title="Financial impact" />
          <div className="space-y-2 px-5 py-5">
            <p className="type-heading text-fog">Not available</p>
            <p className="text-sm text-ash">The supplied data has no prices or costs, so no savings or ROI are estimated.</p>
          </div>
        </section>
      </div>

      <section className="overflow-hidden rounded-lg border border-border bg-card" aria-labelledby="data-heading">
        <PanelHeader
          id="data-heading"
          title="Data loaded"
          note="Loaded once from the supplied sample files. Sales cover 16 weeks (2026-W27 to 2026-W42), not three years."
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-ash">
                <th className="type-label px-5 py-3 font-normal">Dataset</th>
                <th className="type-label px-5 py-3 text-right font-normal">Rows</th>
                <th className="type-label px-5 py-3 font-normal">Latest</th>
                <th className="type-label px-5 py-3 font-normal">Imported</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {status.map((d) => (
                <tr key={d.dataset}>
                  <td className="px-5 py-3 font-medium">{DATASET_LABELS[d.dataset] ?? d.dataset}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{fmtInt(d.rows)}</td>
                  <td className="px-5 py-3 tabular-nums text-ash">{d.latestDate ? (d.latestDate.includes("-W") || d.dataset === "calendar" ? d.latestDate : fmtDate(d.latestDate)) : "n/a"}</td>
                  <td className="px-5 py-3 text-ash">{d.importedAt ? fmtDateTime(d.importedAt) : "Not imported"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
