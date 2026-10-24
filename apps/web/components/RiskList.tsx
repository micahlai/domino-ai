"use client";

import { formatCents } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { RiskEvent } from "@domino/contracts";

export function RiskList({
  risks,
  selectedId,
  onSelect,
}: { risks: RiskEvent[]; selectedId?: string; onSelect: (id: string) => void }) {
  return (
    <ul className="space-y-2">
      {risks.map((risk) => (
        <li key={risk.id}>
          <button
            type="button"
            aria-pressed={selectedId === risk.id}
            onClick={() => onSelect(risk.id)}
            className={cn(
              "w-full rounded-lg border border-transparent p-3 text-left transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
              selectedId === risk.id && "border-border bg-muted",
            )}
          >
            <span className="block text-sm font-medium">{risk.label}</span>
            <span className="mt-2 flex flex-wrap justify-between gap-2 text-sm text-muted-foreground">
              <span>{Math.round(risk.probability * 100)}% chance</span>
              <span>{formatCents(risk.impactLowPoint)} lower at the low point</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
