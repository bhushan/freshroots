import Link from "next/link";
import { Info } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import type { AccessMode } from "@/lib/server/context";
import { cn } from "@/lib/utils";

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-graphite bg-card px-6 py-12 text-center">
      <h2 className="type-panel">{title}</h2>
      {children && <div className="mx-auto mt-2 max-w-prose text-sm text-ash">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** Explains why controls are disabled for this visitor. Renders nothing for the signed-in planner. */
export function AccessNotice({ mode, what = "make changes" }: { mode: AccessMode; what?: string }) {
  if (mode === "admin") return null;
  const text =
    mode === "demo"
      ? `This is a read-only demo, so you cannot ${what}.`
      : mode === "misconfigured"
        ? `Sign-in is unavailable because the session secret is missing or too short, so you cannot ${what}.`
        : `Sign in as the planner to ${what}.`;
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-border bg-card px-4 py-3 text-sm text-ash">
      <Info className="mt-0.5 size-4 shrink-0 text-cornflower" strokeWidth={1.75} aria-hidden />
      <span>
        {text}{" "}
        {mode === "signed-out" && (
          <Link href="/login" className={cn(buttonVariants({ variant: "link" }), "h-auto p-0 align-baseline text-snow")}>
            Sign in
          </Link>
        )}
      </span>
    </div>
  );
}

export function SetupNeeded({ reason }: { reason: "no-database" | "error" }) {
  return (
    <EmptyState title={reason === "no-database" ? "Connect a database to begin" : "The database could not be reached"}>
      {reason === "no-database" ? (
        <>
          Set <code className="rounded-[4px] bg-carbon px-1.5 font-mono text-xs">DATABASE_URL</code> to your Neon connection string, then run{" "}
          <code className="rounded-[4px] bg-carbon px-1.5 font-mono text-xs">npm run db:migrate</code> and{" "}
          <code className="rounded-[4px] bg-carbon px-1.5 font-mono text-xs">npm run db:seed</code>. The README has the exact steps.
        </>
      ) : (
        <>Check that DATABASE_URL is correct and that the Neon project is awake, then reload this page. Nothing has been changed.</>
      )}
    </EmptyState>
  );
}
