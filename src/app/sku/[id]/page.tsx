import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, TriangleAlert } from "lucide-react";
import { AiCard } from "@/components/ai-card";
import { CoverageGauge } from "@/components/coverage-gauge";
import { SetupNeeded } from "@/components/notice";
import { ActionText, FlagBadge, StatusBadge } from "@/components/risk-badge";
import { SalesChart } from "@/components/sales-chart";
import { getStore, isDatabaseConfigured } from "@/db/client";
import { skuIdParam } from "@/lib/api/schemas";
import { fmtAvg, fmtDate, fmtDateTime, fmtDecimal, fmtInt, fmtWeeks } from "@/lib/format";
import { STATUS_LABELS } from "@/lib/labels";
import { getSkuDetail } from "@/lib/queries";
import { RULES } from "@/lib/rules/config";
import { getAccessMode } from "@/lib/server/context";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: (await params).id };
}

const ACTION_VERBS: Record<string, string> = {
  approve: "approved the recommendation",
  reject: "rejected the recommendation",
  override: "overrode the quantity",
  investigate: "marked this for investigation",
};

function Metric({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg bg-carbon p-5">
      <dt className="text-sm text-ash">{label}</dt>
      <dd className="mt-3 text-[28px] font-semibold leading-none tracking-[-0.6px] tabular-nums">{children}</dd>
      {hint && <p className="mt-2 text-xs text-ash">{hint}</p>}
    </div>
  );
}

export default async function SkuPage({ params }: { params: Promise<{ id: string }> }) {
  const parsed = skuIdParam.safeParse((await params).id);
  if (!parsed.success) notFound();
  if (!isDatabaseConfigured()) return <SetupNeeded reason="no-database" />;

  let detail;
  try {
    detail = await getSkuDetail(getStore().db, parsed.data);
  } catch {
    return <SetupNeeded reason="error" />;
  }
  if (!detail) notFound();

  const mode = await getAccessMode();
  const { rec, run, sales, history, distributor, cachedExplanation } = detail;
  const uplift = RULES.festivalUplift;
  const t = rec.perishability === "High" ? RULES.highPerishability : RULES.ordinary;
  const flagged = new Set(rec.flags.map((f) => f.code));
  const manual = rec.action.startsWith("MANUAL_REVIEW");

  return (
    <div className="space-y-8">
      <div>
        <Link href="/workbench" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" aria-hidden />
          Workbench
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="type-heading">
            {rec.skuId} <span className="font-normal text-muted-foreground">{rec.skuName}</span>
          </h1>
          <StatusBadge status={rec.reviewStatus} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {rec.category}, {rec.perishability} perishability
          {distributor && <>, supplied by {distributor.name} ({distributor.region})</>}. Sales history is not split by distributor in the supplied data.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-card" aria-labelledby="rec-heading">
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-5">
          <div className="min-w-0 space-y-2">
            <h2 id="rec-heading" className="type-label text-ash">
              Recommendation (proposal, needs planner approval)
            </h2>
            <p className="type-panel text-[18px]">
              <ActionText action={rec.action} />
            </p>
            <div className="flex flex-wrap gap-1.5">
              {rec.flags.length === 0 ? <span className="text-sm text-muted-foreground">No risk flags</span> : rec.flags.map((f) => <FlagBadge key={f.code} code={f.code} />)}
            </div>
            <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">{rec.explanation}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-muted-foreground">{rec.finalQty !== null ? "Decided quantity" : "Suggested quantity"}</p>
            <p className="type-stat tabular-nums">{manual && rec.finalQty === null ? "None" : fmtInt(rec.finalQty ?? rec.suggestedQty)}</p>
            {rec.finalQty !== null && rec.finalQty !== rec.suggestedQty && <p className="text-xs text-muted-foreground">System suggested {rec.suggestedQty === null ? "none" : fmtInt(rec.suggestedQty)}</p>}
            <Link href="/review" className="mt-2 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">
              {rec.reviewStatus === "pending" || rec.reviewStatus === "investigating" ? "Review in queue" : `${STATUS_LABELS[rec.reviewStatus]}, see queue`}
            </Link>
          </div>
        </div>
        {rec.warnings.length > 0 && (
          <div className="border-t border-graphite bg-carbon px-5 py-4 text-sm text-ash">
            <p className="flex items-center gap-2 font-medium text-snow">
              <TriangleAlert className="size-4" strokeWidth={1.75} aria-hidden />
              Data-quality warnings
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-6">
              {rec.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Key figures">
        <dl className="contents">
          <Metric label="Standard reorder">{fmtInt(rec.standardReorderQty)}</Metric>
          <Metric label="4-week average" hint={rec.festivalUpliftApplied ? `adjusted ${fmtAvg(rec.avg4Adjusted)}` : undefined}>
            {fmtAvg(rec.avg4Raw)}
          </Metric>
          <Metric label="12-week average" hint={rec.festivalUpliftApplied ? `adjusted ${fmtAvg(rec.avg12Adjusted)}` : rec.avg12Raw === null ? `${rec.distinctWeeks} weeks of data` : undefined}>
            {fmtAvg(rec.avg12Raw)}
          </Metric>
          <Metric label="Units on hand" hint={`as of ${fmtDate(run.snapshotDate)}`}>
            {fmtInt(rec.unitsOnHand)}
          </Metric>
          <Metric label="Stock coverage" hint="on adjusted 12-week demand">
            {fmtWeeks(rec.coverageWeeks)}
          </Metric>
          <Metric label="Festival adjustment" hint={rec.festivalUpliftApplied ? `${run.analysisMonth}` : undefined}>
            {rec.festivalUpliftApplied ? `+${Math.round((uplift - 1) * 100)}%` : "None"}
          </Metric>
        </dl>
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="rounded-lg border border-border bg-card lg:col-span-3" aria-labelledby="sales-heading">
          <header className="border-b border-border px-5 py-4">
            <h2 id="sales-heading" className="type-panel">
              Weekly sales
            </h2>
            <p className="text-xs text-muted-foreground">
              {sales.length} observed weeks, latest {rec.latestWeek ?? "n/a"}. The shaded band is the latest four weeks. Averages on the chart are raw, before any festival uplift.
            </p>
          </header>
          <div className="px-2 py-3">
            <SalesChart data={sales} avg4Raw={rec.avg4Raw} avg12Raw={rec.avg12Raw} />
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card lg:col-span-2" aria-labelledby="cover-heading">
          <header className="border-b border-border px-5 py-4">
            <h2 id="cover-heading" className="type-panel">
              Stock coverage
            </h2>
            <p className="text-xs text-muted-foreground">{rec.perishability === "High" ? "High-perishability" : "Standard"} thresholds apply to this SKU.</p>
          </header>
          <div className="space-y-4 px-5 py-5">
            <CoverageGauge coverageWeeks={rec.coverageWeeks} perishability={rec.perishability} large />
            <ul className="space-y-1 pt-3 text-sm">
              <li>
                <span className="inline-block size-2.5 rounded-[2px] bg-graphite" aria-hidden /> Stockout Risk below {t.stockoutBelowWeeks} weeks (lighter zone)
              </li>
              <li>
                <span className="inline-block size-2.5 rounded-[2px] border border-steel bg-carbon" aria-hidden /> Normal from {t.stockoutBelowWeeks} to {t.overstockAboveWeeks} weeks (dark zone)
              </li>
              <li>
                <span className="inline-block size-2.5 rounded-[2px] bg-graphite" aria-hidden /> Overstock Risk above {t.overstockAboveWeeks} weeks (lighter zone)
              </li>
            </ul>
            <p className="text-sm text-muted-foreground">
              {rec.coverageWeeks === null
                ? "Coverage could not be calculated for this SKU."
                : `${fmtInt(rec.unitsOnHand)} units ÷ ${fmtDecimal(rec.avg12Adjusted)} units per week = ${fmtDecimal(rec.coverageWeeks)} weeks.`}
            </p>
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-border bg-card" aria-labelledby="rules-heading">
        <header className="border-b border-border px-5 py-4">
          <h2 id="rules-heading" className="type-panel">
            How this was decided
          </h2>
          <p className="text-xs text-muted-foreground">Fixed business rules produced this result. AI plays no part in the calculation.</p>
        </header>
        <ol className="divide-y divide-border text-sm">
          <li className="px-5 py-4">
            <p className="font-medium">Sales averages</p>
            <p className="text-muted-foreground">
              4-week average {fmtDecimal(rec.avg4Raw)}, 12-week average {fmtDecimal(rec.avg12Raw)}, from {rec.distinctWeeks} observed weeks. Missing weeks are never counted as zero.
            </p>
          </li>
          <li className="px-5 py-4">
            <p className="font-medium">Festival uplift</p>
            <p className="text-muted-foreground">
              {rec.festivalUpliftApplied
                ? `${run.analysisMonth} is a festival month, so both averages were multiplied by ${uplift} once: ${fmtDecimal(rec.avg4Raw)} × ${uplift} = ${fmtDecimal(rec.avg4Adjusted)} and ${fmtDecimal(rec.avg12Raw)} × ${uplift} = ${fmtDecimal(rec.avg12Adjusted)}.`
                : `${run.analysisMonth} is not a festival month, so no uplift was applied.`}
            </p>
          </li>
          <RuleRow
            title="High Demand"
            triggered={flagged.has("HIGH_DEMAND")}
            rule={`Adjusted 4-week average more than ${Math.round((RULES.highDemandRatio - 1) * 100)}% above the adjusted 12-week average, then reorder ${RULES.highDemandQtyMultiplier}× the standard quantity.`}
            detail={rec.flags.find((f) => f.code === "HIGH_DEMAND")?.actual}
          />
          <RuleRow
            title="Stockout Risk"
            triggered={flagged.has("STOCKOUT_RISK")}
            rule={`Coverage below ${t.stockoutBelowWeeks} weeks for ${rec.perishability === "High" ? "High-perishability" : "standard"} SKUs, then reorder at the standard quantity.`}
            detail={rec.flags.find((f) => f.code === "STOCKOUT_RISK")?.actual}
          />
          <RuleRow
            title="Overstock Risk"
            triggered={flagged.has("OVERSTOCK_RISK")}
            rule={`Coverage above ${t.overstockAboveWeeks} weeks for ${rec.perishability === "High" ? "High-perishability" : "standard"} SKUs, then pause the next order.`}
            detail={rec.flags.find((f) => f.code === "OVERSTOCK_RISK")?.actual}
          />
          {flagged.has("INSUFFICIENT_DATA") && (
            <RuleRow title="Insufficient Data" triggered rule={`At least ${RULES.longWindowWeeks} distinct observed weeks are needed.`} detail={rec.flags.find((f) => f.code === "INSUFFICIENT_DATA")?.actual} />
          )}
          <li className="px-5 py-4">
            <p className="font-medium">Result</p>
            <p className="text-muted-foreground">{rec.explanation}</p>
          </li>
        </ol>
      </section>

      <AiCard kind="explain" skuId={rec.skuId} initial={cachedExplanation} canGenerate={mode === "admin"} />

      <section className="rounded-lg border border-border bg-card" aria-labelledby="history-heading">
        <header className="border-b border-border px-5 py-4">
          <h2 id="history-heading" className="type-panel">
            Review history
          </h2>
        </header>
        {history.length === 0 ? (
          <p className="px-5 py-5 text-sm text-muted-foreground">No planner decisions recorded yet.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {history.map((h) => (
              <li key={h.id} className="px-5 py-4">
                <p>
                  <span className="font-medium">{h.reviewer}</span> {ACTION_VERBS[h.action] ?? h.action}. Status {h.priorStatus} to {h.newStatus}
                  {h.newQty !== null && <>, quantity {h.priorQty === null ? "none" : fmtInt(h.priorQty)} to {fmtInt(h.newQty)}</>}.
                </p>
                {h.note && <p className="mt-0.5 text-muted-foreground">Note: {h.note}</p>}
                <p className="text-xs text-muted-foreground">{fmtDateTime(h.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        Analysis of {fmtDateTime(run.createdAt)} using the inventory snapshot of {fmtDate(run.snapshotDate)}.
      </p>
    </div>
  );
}

function RuleRow({ title, triggered, rule, detail }: { title: string; triggered: boolean; rule: string; detail?: string }) {
  return (
    <li className="px-5 py-4">
      <p className="flex items-center gap-2 font-medium">
        {title}
        <span className={cn("rounded-[4px] px-1.5 py-0.5 text-xs font-medium", triggered ? "bg-snow text-ink" : "bg-carbon text-fog")}>
          {triggered ? "Triggered" : "Not triggered"}
        </span>
      </p>
      <p className="text-muted-foreground">{rule}</p>
      {triggered && detail && <p className="mt-0.5 tabular-nums">Calculation: {detail}</p>}
    </li>
  );
}
