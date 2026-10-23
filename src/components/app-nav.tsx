"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/", label: "Overview" },
  { href: "/workbench", label: "Workbench" },
  { href: "/review", label: "Review queue" },
] as const;

export function AppNav({ pending }: { pending: number }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href) || (href === "/workbench" && pathname.startsWith("/sku"));

  return (
    <nav aria-label="Main" className="flex">
      {ITEMS.map(({ href, label }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex h-12 items-center gap-2 px-3 text-sm font-medium whitespace-nowrap transition-colors hover:text-snow md:h-16",
              active ? "text-snow" : "text-ash",
              // the single accent marks where you are
              active && "after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:bg-cornflower",
            )}
          >
            {label}
            {href === "/review" && pending > 0 && (
              <span className="rounded-[4px] bg-carbon px-1.5 text-xs tabular-nums text-snow" aria-label={`${pending} awaiting review`}>
                {pending}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
