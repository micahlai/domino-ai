"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "../../lib/utils";
import { CASE_BASE, caseHref, openInvestigation } from "./links";

const link =
  "flex min-h-11 items-center rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";

export function CaseNav() {
  const pathname = usePathname();
  const id = openInvestigation(pathname, useSearchParams().get("c"));
  const items = [
    { label: "Workspace", href: caseHref.workspace(id), on: pathname === CASE_BASE },
    { label: "Company", href: caseHref.company(id), on: pathname === `${CASE_BASE}/company` },
    {
      label: "Simulations",
      href: caseHref.simulations(id),
      on: pathname.startsWith(`${CASE_BASE}/simulations`),
    },
  ];
  return (
    <header className="flex shrink-0 min-h-12 flex-wrap items-center gap-x-6 gap-y-1 border-b px-4 py-1">
      <div className="min-w-0 flex-1 basis-56">
        <h1 className="text-sm font-medium">2U, late 2023</h1>
        <p className="text-xs text-muted-foreground">
          Public case study. A look back, not a prediction made at the time.
        </p>
      </div>
      <nav aria-label="Case" className="flex flex-wrap gap-1">
        {items.map(({ label, href, on }) => (
          <Link
            key={label}
            href={href}
            aria-current={on ? "page" : undefined}
            className={cn(link, on && "bg-muted font-medium text-foreground")}
          >
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
