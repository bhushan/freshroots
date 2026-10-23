"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { postJson } from "@/lib/client-api";

export function RunAnalysisButton({ enabled, label = "Re-run analysis" }: { enabled: boolean; label?: string }) {
  const router = useRouter();
  const [state, setState] = useState<{ busy: boolean; error?: string; done?: boolean }>({ busy: false });

  async function run() {
    setState({ busy: true });
    const res = await postJson("/api/analysis/run");
    if (!res.ok) return setState({ busy: false, error: res.message });
    setState({ busy: false, done: true });
    router.refresh();
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button variant="outline" size="sm" onClick={run} disabled={!enabled || state.busy}>
        {state.busy ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
        {state.busy ? "Running analysis" : label}
      </Button>
      <p className="min-h-4 text-xs" role="status" aria-live="polite">
        {state.error && <span className="text-snow">{state.error}</span>}
        {state.done && <span className="text-ash">Analysis updated. Earlier runs and decisions are kept.</span>}
      </p>
    </div>
  );
}
