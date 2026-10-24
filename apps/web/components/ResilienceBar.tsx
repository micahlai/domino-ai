"use client";

import { Switch } from "@/components/ui/switch";
import type { ResilienceReport } from "@domino/contracts";

export function ResilienceBar({
  report,
  reportWithFixes,
  showFixes,
  onToggle,
}: {
  report: ResilienceReport;
  reportWithFixes: ResilienceReport;
  showFixes: boolean;
  onToggle: (value: boolean) => void;
}) {
  const current = showFixes ? reportWithFixes : report;
  return (
    <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
      <div>
        <p className="text-3xl font-medium tracking-tight">
          {current.survivedCount}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            of {current.universes.length} futures survive
          </span>
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {Math.round(current.survivalRate * 100)}% chance of survival, weighted by each future’s
          chance.
        </p>
        <p className="mt-4 text-sm">
          Kestrel breaks with {current.breakingPoints[0]?.label ?? "a large enough cash shock"}.
        </p>
      </div>
      <label
        className="flex min-h-11 shrink-0 cursor-pointer items-center gap-3 text-sm"
        htmlFor="apply-fixes"
      >
        <Switch id="apply-fixes" checked={showFixes} onCheckedChange={onToggle} />
        Apply fixes<span className="sr-only">in the fixture preview</span>
      </label>
    </div>
  );
}
