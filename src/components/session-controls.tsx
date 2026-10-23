"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import type { AccessMode } from "@/lib/server/context";
import { cn } from "@/lib/utils";

export function SessionControls({ mode }: { mode: AccessMode }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.refresh();
    setBusy(false);
  }

  if (mode === "admin") {
    return (
      <div className="flex items-center gap-3">
        <span className="hidden text-sm text-ash sm:inline">Signed in as planner</span>
        <Button variant="outline" onClick={signOut} disabled={busy} className="h-9 px-4">
          Sign out
        </Button>
      </div>
    );
  }
  if (mode === "demo") {
    return <span className="type-label text-ash" title="No admin password is set, so changes are disabled.">Read-only demo</span>;
  }
  if (mode === "misconfigured") {
    return <span className="type-label text-ash" title="The session secret is missing or too short.">Sign-in unavailable</span>;
  }
  return (
    <Link href="/login" className={cn(buttonVariants(), "h-9 px-4")}>
      Sign in
    </Link>
  );
}
