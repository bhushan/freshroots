"use client";

import Link from "next/link";
import { useState } from "react";
import { CircleAlert, Loader2, Sparkles } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ExplainOutput, SummaryOutput } from "@/lib/ai/schema";
import { postJson } from "@/lib/client-api";

type Props =
  | { kind: "summary"; initial: SummaryOutput | null; canGenerate: boolean }
  | { kind: "explain"; skuId: string; initial: ExplainOutput | null; canGenerate: boolean };

export function AiCard(props: Props) {
  const [data, setData] = useState<SummaryOutput | ExplainOutput | null>(props.initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);
  const isSummary = props.kind === "summary";

  async function generate() {
    setBusy(true);
    setError(null);
    const res = await postJson<{ data?: SummaryOutput | ExplainOutput }>(
      isSummary ? "/api/ai/summary" : `/api/ai/explain/${(props as { skuId: string }).skuId}`,
    );
    setBusy(false);
    if (res.ok && res.data.data) return setData(res.data.data);
    setError({ title: "AI commentary unavailable", message: res.message ?? "Something went wrong." });
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card" aria-label={isSummary ? "Operational summary" : "Recommendation explanation"}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="type-panel flex items-center gap-2">
          <Sparkles className="size-4 text-cornflower" strokeWidth={1.75} aria-hidden />
          {isSummary ? "Operational summary" : "Explanation"}
        </h2>
        <Button variant="outline" size="sm" onClick={generate} disabled={!props.canGenerate || busy}>
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          {busy ? "Writing" : data ? "Regenerate" : isSummary ? "Generate summary" : "Explain this recommendation"}
        </Button>
      </header>

      <div className="space-y-3 px-4 py-4 text-sm" aria-live="polite">
        {error && (
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertTitle>{error.title}</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}
        {!data && !error && !busy && (
          <p className="text-muted-foreground">
            {props.canGenerate
              ? isSummary
                ? "Write a short plain-language summary of the latest results."
                : "Get a plain-language explanation of why this recommendation was made."
              : "Sign in as the planner to generate AI commentary. Calculations never depend on it."}
          </p>
        )}
        {busy && <p className="text-muted-foreground">Writing commentary from the calculated results.</p>}
        {data && "headline" in data && <SummaryView data={data} />}
        {data && "drivers" in data && <ExplainView data={data} />}
      </div>

      <footer className="space-y-1 border-t border-border bg-carbon/50 px-4 py-3 text-xs text-ash">
        <p>
          <strong className="font-medium text-snow">AI-generated commentary explains results only.</strong> Deterministic rules decide every recommendation and quantity.
        </p>
        <p>Gemini free-tier submissions may be used to improve Google&apos;s products. Only calculated metrics from the sample data are sent. Do not use confidential company data in this demo.</p>
      </footer>
    </section>
  );
}

function SummaryView({ data }: { data: SummaryOutput }) {
  return (
    <div className="space-y-3">
      <p className="type-panel leading-snug">{data.headline}</p>
      <ul className="list-disc space-y-1.5 pl-5 leading-relaxed">
        {data.bullets.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>
      {data.skusToWatch.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground">Worth watching:</span>
          {data.skusToWatch.map((id) => (
            <Link key={id} href={`/sku/${id}`} className="rounded-[4px] border border-steel px-1.5 py-0.5 text-xs font-medium text-snow hover:bg-carbon">
              {id}
            </Link>
          ))}
        </p>
      )}
    </div>
  );
}

function ExplainView({ data }: { data: ExplainOutput }) {
  return (
    <div className="space-y-3">
      <p className="leading-relaxed">{data.summary}</p>
      <ul className="list-disc space-y-1.5 pl-5 leading-relaxed">
        {data.drivers.map((d, i) => (
          <li key={i}>{d}</li>
        ))}
      </ul>
      {data.caveats.length > 0 && (
        <div>
          <p className="font-medium">Keep in mind</p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {data.caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
