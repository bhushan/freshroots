"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { postJson } from "@/lib/client-api";

interface SyncSummary {
  linked: number;
  created: number;
  skipped: { sku: string; reason: string }[];
  defaulted: { sku: string; fields: string[] }[];
}

export function ZohoSyncButton({ enabled, connected }: { enabled: boolean; connected: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<{ busy: boolean; error?: string; result?: SyncSummary }>({ busy: false });

  async function run() {
    setState({ busy: true });
    const res = await postJson<SyncSummary>("/api/zoho/sync");
    if (!res.ok) return setState({ busy: false, error: res.message });
    setState({ busy: false, result: res.data });
    router.refresh();
  }

  const r = state.result;
  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button variant="outline" size="sm" onClick={run} disabled={!enabled || !connected || state.busy} title={connected ? undefined : "Set the ZOHO_* variables to connect Zoho Books."}>
        {state.busy ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
        {state.busy ? "Syncing" : "Sync items from Zoho"}
      </Button>
      <div className="min-h-4 space-y-1 text-xs" role="status" aria-live="polite">
        {!connected && <p className="text-ash">Zoho Books is not connected.</p>}
        {state.error && <p className="text-snow">{state.error}</p>}
        {r && (
          <>
            <p className="text-ash">
              {r.created} new, {r.linked} updated, {r.skipped.length} skipped. Re-run the analysis to include new SKUs.
            </p>
            {r.defaulted.length > 0 && <p className="text-ash">Defaults used: {r.defaulted.map((d) => `${d.sku} (${d.fields.join(", ")})`).join("; ")}.</p>}
            {r.skipped.map((s) => (
              <p key={s.sku} className="text-snow">
                {s.sku}: {s.reason}
              </p>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
