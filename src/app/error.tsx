"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto mt-10 max-w-md rounded-lg border border-border bg-card p-8 text-center">
      <h1 className="type-panel">This page could not load</h1>
      <p className="mt-2 text-sm text-ash">Your data was not changed. Try again, and if it keeps failing check the database connection.</p>
      <Button className="mt-4" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
