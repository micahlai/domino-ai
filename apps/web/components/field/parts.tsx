"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { useFieldData } from "./data";
import type { FieldFinding, OperationKind } from "./types";

export const FINDING_LABEL: Record<FieldFinding["kind"], string> = {
  duplicate: "Possible duplicate",
  conflict: "Records disagree",
  unusual_amount: "Unusual amount",
  unusual_timing: "Unusual timing",
  missing_expected: "Expected item missing",
};

export const SEVERITY_LABEL: Record<FieldFinding["severity"], string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const SEVERITY_TONE: Record<FieldFinding["severity"], string> = {
  high: "border-destructive/50 bg-destructive/10 text-[hsl(var(--danger-text))]",
  medium: "border-clay/50 bg-clay/10 text-clay",
  low: "border-border bg-muted text-muted-foreground",
};

export const OPERATION_LABEL: Record<OperationKind, string> = {
  pull: "Read",
  map: "Matched",
  snapshot: "Saved",
  audit: "Checked",
  decision: "Decision",
  export: "Exported",
  spawn: "Started helper",
};

/** "just now", "4 min ago", then a date. Re-renders every 30 s so labels stay true. */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function timeAgo(iso: string | null | undefined, now: number): string {
  if (!iso) return "never";
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "unknown";
  const s = Math.round((now - at) / 1000);
  if (s < -60) return clock(iso);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function clock(iso: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return iso;
  return new Date(at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Says where the numbers come from. Demo data is always labelled as such. */
export function DataLabel({ className }: { className?: string }) {
  const { source, sourceNote } = useFieldData();
  if (source === "live")
    return (
      <Badge variant="outline" className={cn("gap-1.5 font-normal", className)}>
        <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
        Live
      </Badge>
    );
  if (source === "loading")
    return (
      <Badge variant="outline" className={cn("font-normal text-muted-foreground", className)}>
        Connecting...
      </Badge>
    );
  return (
    <Badge
      variant="outline"
      title={sourceNote}
      className={cn("border-dashed font-normal text-clay", className)}
    >
      Demo data · {sourceNote.toLowerCase()}
    </Badge>
  );
}

const TABS = [
  { href: "/field", label: "Review and actions" },
  { href: "/field/map", label: "Brain map" },
];

export function FieldTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Agent workspace" className="flex gap-1 rounded-lg border bg-muted/40 p-1">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex min-h-9 items-center rounded-md px-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
              active && "bg-background font-medium text-foreground shadow-sm",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
