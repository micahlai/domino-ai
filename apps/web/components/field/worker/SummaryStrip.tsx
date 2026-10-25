"use client";

import { useQuery } from "convex/react";
import type { ReactNode } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { cn } from "../../../lib/utils";
import { StatTile } from "../../ui/page";
import { day, money } from "./format";

// One row of counts at the top of the worker page. Each tile links to its section below and
// shows the same number that section shows: callers pass counts from the section's own data.

export type SummaryCounts = {
  /** Open recommended fixes; null while loading. */
  fixes: number | null;
  flags: number | null;
  /** Risk scenarios that break the minimum or a rule; null while loading. */
  risks: number | null;
  /** Lowest projected usable cash in the 13-week forecast, when there is one. */
  lowest?: { cents: number; weekStart: string } | null;
  belowMinimum?: boolean;
};

const tileLink =
  "block rounded-lg transition-colors hover:[&>div]:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

const count = (n: number | null | undefined) => (n === null || n === undefined ? "..." : n);

export function SummaryStrip({
  counts,
  companyId,
}: { counts: SummaryCounts; companyId?: string | null }) {
  const tiles: { href: string; label: string; value: ReactNode; delta?: string }[] = [
    {
      href: "#suggestions-title",
      label: "Recommended fixes",
      value: count(counts.fixes),
      delta: "Open",
    },
    { href: "#flags-title", label: "Flags to review", value: count(counts.flags), delta: "Open" },
    {
      href: "#risks-title",
      label: "Risks",
      value: count(counts.risks),
      delta: "Below the minimum or a rule",
    },
  ];
  return (
    <nav aria-label="Summary" className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
      {tiles.map((t) => (
        <a key={t.href} href={t.href} className={cn(tileLink, "sm:min-w-[150px] sm:flex-1")}>
          <StatTile label={t.label} value={t.value} delta={t.delta} className="h-full" />
        </a>
      ))}
      {companyId ? <LearnedTile companyId={companyId} /> : null}
      {counts.lowest ? (
        <a href="#risks-title" className={cn(tileLink, "col-span-2 sm:min-w-[190px] sm:flex-1")}>
          <StatTile
            label="Lowest cash this quarter"
            value={money(counts.lowest.cents)}
            delta={`Week of ${day(counts.lowest.weekStart) ?? "unknown"}${
              counts.belowMinimum ? " · below the minimum" : ""
            }`}
            tone={counts.belowMinimum ? "negative" : "neutral"}
            className="h-full"
          />
        </a>
      ) : null}
    </nav>
  );
}

/** Same query LearnedSection reads, so the count matches the section. Live backend only. */
function LearnedTile({ companyId }: { companyId: string }) {
  const data = useQuery(api.fieldLearning.list, { companyId: companyId as Id<"companies"> });
  return (
    <a href="#learned" className={cn(tileLink, "sm:min-w-[150px] sm:flex-1")}>
      <StatTile
        label="Learned rules"
        value={count(data ? data.rules.filter((r) => r.active).length : null)}
        delta="Active"
        className="h-full"
      />
    </a>
  );
}
