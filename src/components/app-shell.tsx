import Link from "next/link";
import { Sprout } from "lucide-react";
import { AppNav } from "@/components/app-nav";
import { SessionControls } from "@/components/session-controls";
import type { ShellInfo } from "@/lib/queries";
import { fmtDate } from "@/lib/format";
import type { AccessMode } from "@/lib/server/context";

export function AppShell({ info, mode, children }: { info: ShellInfo | null; mode: AccessMode; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Announcement bar: the standing scope disclaimer. Dark text keeps contrast above 7:1 on the blue. */}
      <div className="bg-cornflower px-4 py-2 text-center text-sm font-medium text-ink">
        {info?.snapshotDate ? (
          <>
            Figures reflect the inventory snapshot of {fmtDate(info.snapshotDate)}, not live SAP data. Every recommendation is a proposal that needs planner approval. Non-commercial case-study prototype.
          </>
        ) : (
          <>No analysis yet. Every recommendation is a proposal that needs planner approval. Non-commercial case-study prototype.</>
        )}
      </div>

      <header className="sticky top-0 z-30 border-b border-border bg-background">
        <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center gap-x-8 px-4 md:px-6">
          <Link href="/" className="flex h-16 items-center gap-2.5 text-snow">
            <Sprout className="size-5 text-cornflower" strokeWidth={1.75} aria-hidden />
            <span className="text-base font-semibold tracking-[-0.19px]">Freshroots</span>
            <span className="hidden text-sm text-ash sm:inline">Demand planning</span>
          </Link>
          <div className="order-3 -mx-4 w-[calc(100%+2rem)] overflow-x-auto px-4 md:order-none md:mx-0 md:w-auto md:overflow-visible md:px-0">
            <AppNav pending={info?.pending ?? 0} />
          </div>
          <div className="ml-auto flex h-16 items-center">
            <SessionControls mode={mode} />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-10 md:px-6">{children}</main>

      <footer className="border-t border-border bg-background px-4 py-6 md:px-6">
        <p className="mx-auto max-w-[1440px] text-sm text-ash">
          Rules decide every recommendation. AI only explains them. Sales data covers 16 weeks of the supplied sample (2026-W27 to 2026-W42).
        </p>
      </footer>
    </div>
  );
}
