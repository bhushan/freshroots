import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto mt-10 max-w-md rounded-lg border border-border bg-card p-8 text-center">
      <h1 className="type-panel">Nothing here</h1>
      <p className="mt-2 text-sm text-ash">That SKU or page is not part of the latest analysis.</p>
      <Link href="/workbench" className={`${buttonVariants()} mt-4`}>
        Open the workbench
      </Link>
    </div>
  );
}
