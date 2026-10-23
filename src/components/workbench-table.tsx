"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import { CoverageGauge } from "@/components/coverage-gauge";
import { ActionText, FlagBadge, StatusBadge } from "@/components/risk-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RecRow } from "@/lib/queries";
import { fmtAvg, fmtInt, fmtWeeks } from "@/lib/format";
import { STATUS_LABELS } from "@/lib/labels";
import { hasFlag, isManual, priority } from "@/lib/priority";
import type { FlagCode } from "@/lib/rules/engine";
import { cn } from "@/lib/utils";

export const FLAG_FILTERS = ["HIGH_DEMAND", "STOCKOUT_RISK", "OVERSTOCK_RISK", "MANUAL_REVIEW", "INSUFFICIENT_DATA"] as const;
type FlagFilter = (typeof FLAG_FILTERS)[number];

const FLAG_FILTER_LABELS: Record<FlagFilter, string> = {
  HIGH_DEMAND: "High Demand",
  STOCKOUT_RISK: "Stockout Risk",
  OVERSTOCK_RISK: "Overstock Risk",
  MANUAL_REVIEW: "Manual Review",
  INSUFFICIENT_DATA: "Insufficient Data",
};

type SortKey = "priority" | "sku" | "category" | "perishability" | "std" | "avg4" | "avg12" | "onHand" | "coverage" | "action" | "qty" | "status";

/** Left edge of each row: bright for urgent, blue for demand, fading to nothing when no action is proposed. */
const EDGE: Record<number, string> = {
  5: "border-l-snow",
  4: "border-l-snow",
  3: "border-l-cornflower",
  2: "border-l-ash",
  1: "border-l-fog",
  0: "border-l-transparent",
};

function sortValue(r: RecRow, key: SortKey): string | number {
  switch (key) {
    case "priority": return priority(r);
    case "sku": return r.skuId;
    case "category": return r.category;
    case "perishability": return r.perishability;
    case "std": return r.standardReorderQty;
    case "avg4": return r.avg4Adjusted ?? -1;
    case "avg12": return r.avg12Adjusted ?? -1;
    case "onHand": return r.unitsOnHand ?? -1;
    case "coverage": return r.coverageWeeks ?? Number.POSITIVE_INFINITY;
    case "action": return r.action;
    case "qty": return r.finalQty ?? r.suggestedQty ?? -1;
    case "status": return r.reviewStatus;
  }
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="type-label flex flex-col gap-1.5 text-ash">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-lg border border-input bg-background px-3 font-sans text-sm normal-case tracking-normal text-snow focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SortHeader({
  k,
  sort,
  onSort,
  children,
  align = "left",
}: {
  k: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" };
  onSort: (k: SortKey) => void;
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  const active = sort.key === k;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={cn("type-label whitespace-nowrap px-2.5 py-3 font-normal", align === "right" ? "text-right" : "text-left")}>
      <button type="button" onClick={() => onSort(k)} className={cn("inline-flex items-center gap-1 hover:text-foreground", active && "text-foreground")}>
        {children}
        <Icon className="size-3" aria-hidden />
      </button>
    </th>
  );
}

export function WorkbenchTable({ rows, initialFlag }: { rows: RecRow[]; initialFlag?: string }) {
  const [query, setQuery] = useState("");
  const [flag, setFlag] = useState<string>(FLAG_FILTERS.includes(initialFlag as FlagFilter) ? (initialFlag as string) : "");
  const [category, setCategory] = useState("");
  const [perishability, setPerishability] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "priority", dir: "desc" });

  const categories = useMemo(() => [...new Set(rows.map((r) => r.category))].sort(), [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (q && !r.skuId.toLowerCase().includes(q) && !r.skuName.toLowerCase().includes(q)) return false;
      if (flag === "MANUAL_REVIEW" ? !isManual(r) : flag && !hasFlag(r, flag as FlagCode)) return false;
      if (category && r.category !== category) return false;
      if (perishability && r.perishability !== perishability) return false;
      if (status && r.reviewStatus !== status) return false;
      return true;
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    return filtered.sort((a, b) => {
      const av = sortValue(a, sort.key);
      const bv = sortValue(b, sort.key);
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      // Ties fall back to the least cover first, so the most exposed SKU leads.
      return cmp * dir || (a.coverageWeeks ?? Infinity) - (b.coverageWeeks ?? Infinity) || a.skuId.localeCompare(b.skuId);
    });
  }, [rows, query, flag, category, perishability, status, sort]);

  const filtersActive = Boolean(query || flag || category || perishability || status);
  const clear = () => {
    setQuery("");
    setFlag("");
    setCategory("");
    setPerishability("");
    setStatus("");
  };
  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "priority" ? "desc" : "asc" }));
  const th = { sort, onSort: toggleSort };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-border bg-card p-4">
        <label className="type-label flex min-w-56 flex-1 flex-col gap-1.5 text-ash">
          Search
          <span className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2" aria-hidden />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="SKU ID or name" className="h-9 pl-8 font-sans normal-case tracking-normal" />
          </span>
        </label>
        <FilterSelect label="Risk" value={flag} onChange={setFlag} options={FLAG_FILTERS.map((f) => ({ value: f, label: FLAG_FILTER_LABELS[f] }))} />
        <FilterSelect label="Category" value={category} onChange={setCategory} options={categories.map((c) => ({ value: c, label: c }))} />
        <FilterSelect label="Perishability" value={perishability} onChange={setPerishability} options={[{ value: "Low", label: "Low" }, { value: "High", label: "High" }]} />
        <FilterSelect label="Review status" value={status} onChange={setStatus} options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
        {filtersActive && (
          <Button variant="ghost" size="sm" onClick={clear}>
            Clear filters
          </Button>
        )}
      </div>

      <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
        Showing {visible.length} of {rows.length} SKUs. Averages are per week; adjusted figures include the festival uplift when it applies.
      </p>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-graphite bg-card px-6 py-12 text-center">
          <p className="font-medium">No SKUs match these filters</p>
          <p className="mt-1 text-sm text-muted-foreground">Try a different risk or clear the filters.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={clear}>
            Clear filters
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="border-b border-border bg-carbon/40 text-ash">
              <tr>
                <SortHeader k="sku" {...th}>SKU</SortHeader>
                <SortHeader k="category" {...th}>Category</SortHeader>
                <SortHeader k="perishability" {...th}>Perishability</SortHeader>
                <SortHeader k="std" align="right" {...th}>Std qty</SortHeader>
                <SortHeader k="avg4" align="right" {...th}>4-wk avg</SortHeader>
                <SortHeader k="avg12" align="right" {...th}>12-wk avg</SortHeader>
                <SortHeader k="onHand" align="right" {...th}>On hand</SortHeader>
                <SortHeader k="coverage" {...th}>Coverage</SortHeader>
                <th scope="col" className="type-label whitespace-nowrap px-2.5 py-3 text-left font-normal">Festival</th>
                <SortHeader k="priority" {...th}>Risk flags</SortHeader>
                <SortHeader k="action" {...th}>Suggested action</SortHeader>
                <SortHeader k="qty" align="right" {...th}>Qty</SortHeader>
                <SortHeader k="status" {...th}>Review</SortHeader>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map((r) => (
                <tr key={r.id} className="hover:bg-muted/40">
                  <td className={cn("border-l-[3px] px-2.5 py-3", EDGE[priority(r)])}>
                    <Link href={`/sku/${r.skuId}`} className="font-medium text-primary underline-offset-4 hover:underline">
                      {r.skuId}
                    </Link>
                    <p className="max-w-52 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground" title={r.skuName}>
                      {r.skuName}
                    </p>
                  </td>
                  <td className="px-2.5 py-3">{r.category}</td>
                  <td className="px-2.5 py-3">{r.perishability}</td>
                  <td className="px-2.5 py-3 text-right tabular-nums">{fmtInt(r.standardReorderQty)}</td>
                  <td className="px-2.5 py-3 text-right tabular-nums">
                    {fmtAvg(r.avg4Adjusted)}
                    {r.festivalUpliftApplied && r.avg4Raw !== null && <p className="text-xs text-muted-foreground">raw {fmtAvg(r.avg4Raw)}</p>}
                  </td>
                  <td className="px-2.5 py-3 text-right tabular-nums">
                    {fmtAvg(r.avg12Adjusted)}
                    {r.festivalUpliftApplied && r.avg12Raw !== null && <p className="text-xs text-muted-foreground">raw {fmtAvg(r.avg12Raw)}</p>}
                    {r.avg12Raw === null && <p className="text-xs text-muted-foreground">{r.distinctWeeks} wk of data</p>}
                  </td>
                  <td className="px-2.5 py-3 text-right tabular-nums">{fmtInt(r.unitsOnHand)}</td>
                  <td className="px-2.5 py-3">
                    <div className="flex items-center gap-2">
                      <CoverageGauge coverageWeeks={r.coverageWeeks} perishability={r.perishability} className="w-20 shrink-0" />
                      <span className="w-14 text-xs tabular-nums">{fmtWeeks(r.coverageWeeks)}</span>
                    </div>
                  </td>
                  <td className="px-2.5 py-3 text-xs">
                    {r.festivalUpliftApplied ? <span className="font-medium text-snow">+25%</span> : <span className="text-muted-foreground">None</span>}
                  </td>
                  <td className="px-2.5 py-3">
                    <div className="flex flex-wrap gap-1">
                      {r.flags.length === 0 ? <span className="text-xs text-muted-foreground">None</span> : r.flags.map((f) => <FlagBadge key={f.code} code={f.code} />)}
                    </div>
                  </td>
                  <td className="px-2.5 py-3">
                    <ActionText action={r.action} className="block min-w-40 text-xs" />
                  </td>
                  <td className="px-2.5 py-3 text-right tabular-nums">
                    {r.suggestedQty === null && r.finalQty === null ? <span className="text-xs text-muted-foreground">None</span> : fmtInt(r.finalQty ?? r.suggestedQty)}
                    {r.finalQty !== null && r.finalQty !== r.suggestedQty && <p className="text-xs text-muted-foreground">was {r.suggestedQty === null ? "none" : fmtInt(r.suggestedQty)}</p>}
                  </td>
                  <td className="px-2.5 py-3">
                    <StatusBadge status={r.reviewStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
