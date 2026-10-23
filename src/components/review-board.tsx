"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, CircleAlert, Download, Loader2 } from "lucide-react";
import { ActionText, FlagBadge } from "@/components/risk-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { ReviewStatus } from "@/db/schema";
import { postJson } from "@/lib/client-api";
import { fmtDateTime, fmtInt } from "@/lib/format";
import { STATUS_LABELS } from "@/lib/labels";
import { priority } from "@/lib/priority";
import type { PurchaseOrderInfo, RecRow } from "@/lib/queries";
import { cn } from "@/lib/utils";

export interface HistoryEntry {
  id: string;
  action: string;
  reviewer: string;
  priorStatus: string;
  newStatus: string;
  priorQty: number | null;
  newQty: number | null;
  note: string | null;
  createdAt: string;
}

type DecisionType = "approve" | "reject" | "override" | "investigate";

const TABS: ReviewStatus[] = ["pending", "investigating", "approved", "overridden", "rejected"];
const EMPTY: Record<ReviewStatus, string> = {
  pending: "Nothing is waiting for review.",
  investigating: "No recommendations are marked for investigation.",
  approved: "No recommendations have been approved yet.",
  overridden: "No quantities have been overridden.",
  rejected: "No recommendations have been rejected.",
};

const DIALOG_COPY: Record<DecisionType, { title: string; confirm: string; help: string }> = {
  approve: { title: "Approve recommendation", confirm: "Approve", help: "The suggested quantity is recorded as approved and a purchase order is placed in Zoho Books for it. It appears in the procurement export too." },
  reject: { title: "Reject recommendation", confirm: "Reject", help: "No order is proposed for this SKU. Add a note so the reason is on record." },
  override: { title: "Override quantity", confirm: "Save override", help: "Your quantity replaces the suggestion, and the purchase order in Zoho Books uses it. The original suggestion stays on record." },
  investigate: { title: "Mark for investigation", confirm: "Mark for investigation", help: "Moves the item to the investigating tab until you approve, override or reject it." },
};

export function ReviewBoard({
  rows,
  history,
  orders,
  zohoConnected,
  canAct,
  runLabel,
}: {
  rows: RecRow[];
  history: Record<string, HistoryEntry[]>;
  orders: Record<string, PurchaseOrderInfo>;
  zohoConnected: boolean;
  canAct: boolean;
  runLabel: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<string>("pending");
  const [reviewer, setReviewer] = useState("Planner");
  const [dialog, setDialog] = useState<{ row: RecRow; type: DecisionType } | null>(null);
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const ordered = [...rows].sort((a, b) => priority(b) - priority(a) || (a.coverageWeeks ?? Infinity) - (b.coverageWeeks ?? Infinity) || a.skuId.localeCompare(b.skuId));
  const counts = Object.fromEntries(TABS.map((s) => [s, rows.filter((r) => r.reviewStatus === s).length])) as Record<ReviewStatus, number>;
  const exportable = counts.approved + counts.overridden;

  function open(row: RecRow, type: DecisionType) {
    setDialog({ row, type });
    setQty(type === "override" && row.suggestedQty !== null ? String(row.suggestedQty) : "");
    setNote("");
    setError(null);
  }

  async function submit() {
    if (!dialog) return;
    const body: Record<string, unknown> = { type: dialog.type, reviewer: reviewer.trim() || "Planner" };
    if (note.trim()) body.note = note.trim();
    if (dialog.type === "override") {
      if (!/^\d+$/.test(qty.trim())) return setError("Enter the quantity as a whole number of 0 or more.");
      body.overrideQty = Number(qty.trim());
    }
    setBusy(true);
    setError(null);
    const res = await postJson<{ purchaseOrder?: { status: string; number?: string; message?: string } }>(`/api/review/${dialog.row.id}`, body);
    setBusy(false);
    if (!res.ok) return setError(res.message ?? "The decision could not be saved.");
    const done = { approve: "approved", reject: "rejected", override: "overridden", investigate: "marked for investigation" }[dialog.type];
    const po = res.data.purchaseOrder;
    const poText = !po ? "" : po.status === "created" ? ` Purchase order ${po.number} placed in Zoho Books.` : po.status === "pending" ? " Purchase order is waiting to be sent to Zoho Books." : ` The purchase order could not be placed: ${po.message ?? "unknown error"} Retry it from the item.`;
    setFlash(`${dialog.row.skuId} ${done}.${poText}`);
    setDialog(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="reviewer" className="type-label text-ash">
            Reviewer label
          </Label>
          <Input id="reviewer" value={reviewer} onChange={(e) => setReviewer(e.target.value)} maxLength={60} className="w-56" disabled={!canAct} />
        </div>
        {exportable > 0 ? (
          <a href="/api/review/export.csv" download className={buttonVariants({ variant: "outline", size: "sm" })}>
            <Download aria-hidden />
            Export approved ({exportable}) as CSV
          </a>
        ) : (
          <Button variant="outline" size="sm" disabled>
            <Download aria-hidden />
            Export approved (0) as CSV
          </Button>
        )}
      </div>

      <p className="text-sm text-ash">
        {runLabel} The export lists approved and overridden items for manual handoff to procurement. Maintain and Monitor items are left out because they propose no order. {zohoConnected ? "Zoho Books is connected: each approval places a draft purchase order there." : "Zoho Books is not connected, so approvals are recorded here only. Set the ZOHO_* variables to place purchase orders."} This prototype does not connect to SAP.
      </p>

      <div role="status" aria-live="polite" className="min-h-6">
        {flash && (
          <p className="flex items-center gap-2 text-sm text-snow">
            <CheckCircle2 className="size-4 text-cornflower" strokeWidth={1.75} aria-hidden />
            {flash}
          </p>
        )}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        <TabsList className="h-auto flex-wrap">
          {TABS.map((s) => (
            <TabsTrigger key={s} value={s}>
              {STATUS_LABELS[s]} <span className="ml-1 tabular-nums text-muted-foreground">{counts[s]}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((s) => (
          <TabsContent key={s} value={s}>
            {ordered.filter((r) => r.reviewStatus === s).length === 0 ? (
              <p className="rounded-lg border border-dashed border-graphite bg-card px-4 py-10 text-center text-sm text-ash">{EMPTY[s]}</p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                {ordered
                  .filter((r) => r.reviewStatus === s)
                  .map((r) => (
                    <ReviewItem key={r.id} row={r} history={history[r.id] ?? []} order={orders[r.id]} zohoConnected={zohoConnected} canAct={canAct} onAct={open} onSent={(msg) => { setFlash(msg); router.refresh(); }} />
                  ))}
              </ul>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && !busy && setDialog(null)}>
        <DialogContent>
          {dialog && (
            <>
              <DialogHeader>
                <DialogTitle>{DIALOG_COPY[dialog.type].title}</DialogTitle>
                <DialogDescription>
                  {dialog.row.skuId} {dialog.row.skuName}. {DIALOG_COPY[dialog.type].help}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <p className="rounded-md bg-muted px-3 py-2">
                  <ActionText action={dialog.row.action} />
                  <span className="text-muted-foreground"> Suggested quantity: {dialog.row.suggestedQty === null ? "none" : fmtInt(dialog.row.suggestedQty)}</span>
                </p>
                {dialog.type === "override" && (
                  <div className="space-y-1">
                    <Label htmlFor="qty">Quantity to order</Label>
                    <Input id="qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} className="w-40" autoFocus />
                  </div>
                )}
                <div className="space-y-1">
                  <Label htmlFor="note">Note {dialog.type === "approve" ? "(optional)" : ""}</Label>
                  <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} placeholder="Why are you making this decision?" />
                </div>
                {error && (
                  <Alert variant="destructive">
                    <CircleAlert aria-hidden />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialog(null)} disabled={busy}>
                  Cancel
                </Button>
                <Button onClick={submit} disabled={busy}>
                  {busy && <Loader2 className="animate-spin" aria-hidden />}
                  {DIALOG_COPY[dialog.type].confirm}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReviewItem({
  row,
  history,
  order,
  zohoConnected,
  canAct,
  onAct,
  onSent,
}: {
  row: RecRow;
  history: HistoryEntry[];
  order: PurchaseOrderInfo | undefined;
  zohoConnected: boolean;
  canAct: boolean;
  onAct: (row: RecRow, type: DecisionType) => void;
  onSent: (message: string) => void;
}) {
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  async function sendOrder() {
    setSending(true);
    setSendError(null);
    const res = await postJson<{ purchaseOrder?: { number?: string } }>(`/api/review/${row.id}/purchase-order`, undefined);
    setSending(false);
    if (!res.ok) return setSendError(res.message ?? "The purchase order could not be placed.");
    onSent(`${row.skuId}: purchase order ${res.data.purchaseOrder?.number ?? ""} placed in Zoho Books.`);
  }

  const open = row.reviewStatus === "pending" || row.reviewStatus === "investigating";
  const noQty = row.suggestedQty === null;
  const last = history[0];
  return (
    <li className="px-5 py-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1.5">
          <p>
            <Link href={`/sku/${row.skuId}`} className="font-medium text-primary underline-offset-4 hover:underline">
              {row.skuId}
            </Link>{" "}
            <span className="text-sm text-muted-foreground">{row.skuName}</span>
          </p>
          <p className="text-sm">
            <ActionText action={row.action} />
          </p>
          <div className="flex flex-wrap gap-1">
            {row.flags.map((f) => (
              <FlagBadge key={f.code} code={f.code} />
            ))}
          </div>
          <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">{row.explanation}</p>
        </div>

        <div className="text-right">
          <p className="type-label text-ash">{row.finalQty !== null ? "Decided quantity" : "Suggested quantity"}</p>
          <p className="type-heading tabular-nums">{noQty && row.finalQty === null ? "None" : fmtInt(row.finalQty ?? row.suggestedQty)}</p>
          {row.finalQty !== null && row.finalQty !== row.suggestedQty && <p className="text-xs text-muted-foreground">was {noQty ? "none" : fmtInt(row.suggestedQty)}</p>}
        </div>
      </div>

      {open && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => onAct(row, "approve")} disabled={!canAct || noQty} title={noQty ? "Needs manual review: override with a quantity or reject." : undefined}>
            Approve
          </Button>
          <Button size="sm" variant="outline" onClick={() => onAct(row, "override")} disabled={!canAct}>
            Override quantity
          </Button>
          <Button size="sm" variant="outline" onClick={() => onAct(row, "reject")} disabled={!canAct}>
            Reject
          </Button>
          {row.reviewStatus === "pending" && (
            <Button size="sm" variant="ghost" onClick={() => onAct(row, "investigate")} disabled={!canAct}>
              Mark for investigation
            </Button>
          )}
          {noQty && <p className="self-center text-xs text-ash">Manual review item: there is no suggested quantity to approve.</p>}
        </div>
      )}

      {order && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-border px-3 py-2 text-sm">
          <span className="type-label text-ash">Zoho purchase order</span>
          {order.status === "created" ? (
            <span className="font-medium text-snow">{order.number} placed for {fmtInt(order.qty)} units</span>
          ) : order.status === "failed" ? (
            <span className="text-snow">Not placed: {order.error}</span>
          ) : (
            <span className="text-ash">{zohoConnected ? "Waiting to be sent" : "Waiting for Zoho Books to be connected"}</span>
          )}
          {order.status !== "created" && zohoConnected && (
            <Button size="sm" variant="outline" onClick={sendOrder} disabled={!canAct || sending}>
              {sending && <Loader2 className="animate-spin" aria-hidden />}
              {order.status === "failed" ? "Retry order" : "Send order"}
            </Button>
          )}
          {sendError && <span className="w-full text-xs text-snow" role="alert">{sendError}</span>}
        </div>
      )}

      {history.length > 0 && (
        <details className={cn("mt-3 text-sm", !open && "mt-2")}>
          <summary className="cursor-pointer text-ash hover:text-snow">
            History ({history.length}){last ? `, last by ${last.reviewer}` : ""}
          </summary>
          <ul className="mt-3 space-y-3 border-l border-steel pl-4">
            {history.map((h) => (
              <li key={h.id}>
                <p>
                  <span className="font-medium">{h.reviewer}</span>: {h.priorStatus} to {h.newStatus}
                  {h.newQty !== null && <>, quantity {h.priorQty === null ? "none" : fmtInt(h.priorQty)} to {fmtInt(h.newQty)}</>}
                </p>
                {h.note && <p className="text-muted-foreground">Note: {h.note}</p>}
                <p className="text-xs text-muted-foreground">{fmtDateTime(h.createdAt)}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}
