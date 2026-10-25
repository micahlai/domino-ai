"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Select } from "../ui/select";
import { Switch } from "../ui/switch";
import { useFieldData } from "./data";
import { ANOMALY_OPTIONS, type Anomaly, type FieldFinding, type OperationKind } from "./types";

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

export const OPERATION_LABEL: Record<OperationKind, string> = {
  feed: "New entries",
  run: "Ran",
  forecast: "Forecast",
  pull: "Read",
  map: "Matched",
  snapshot: "Saved",
  audit: "Checked",
  decision: "Decision",
  export: "Exported",
  spawn: "Started helper",
  message: "Message",
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

/** Severity as a status badge: red only for high (a likely broken rule), amber for medium. */
export const SEVERITY_BADGE: Record<
  FieldFinding["severity"],
  "destructive" | "warning" | "secondary"
> = {
  high: "destructive",
  medium: "warning",
  low: "secondary",
};

/** Says where the numbers come from. Demo data is always labelled as such. */
export function DataLabel({ className }: { className?: string }) {
  const { source, sourceNote } = useFieldData();
  if (source === "live")
    return (
      <Badge variant="success" className={cn("gap-1.5", className)}>
        <span aria-hidden="true" className="size-1.5 rounded-full bg-safe" />
        Live
      </Badge>
    );
  if (source === "loading")
    return (
      <Badge variant="secondary" className={cn("font-normal", className)}>
        Connecting...
      </Badge>
    );
  return (
    <Badge
      variant="outline"
      title={sourceNote}
      className={cn("gap-1.5 border-dashed font-normal text-muted-foreground", className)}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-clay" />
      Demo data · {sourceNote.toLowerCase()}
    </Badge>
  );
}

/** "Plant an anomaly" choice for the next "New entries arrive". Empty means plain new entries. */
export function AnomalyPicker({
  value,
  onChange,
  disabled,
}: {
  value: Anomaly | "";
  onChange: (value: Anomaly | "") => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <span className="inline-flex min-w-0 items-center gap-2 text-sm">
      <label htmlFor={id} className="shrink-0 text-muted-foreground">
        With
      </label>
      <Select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as Anomaly | "")}
        className="sm:w-56"
      >
        <option value="">no planted anomaly</option>
        {ANOMALY_OPTIONS.map((a) => (
          <option key={a.value} value={a.value}>
            {a.label}
          </option>
        ))}
      </Select>
    </span>
  );
}

/** Auto-ingest on/off (field.setAutoIngest). Reflects the backend value, not a local guess. */
export function AutoIngestToggle() {
  const { status, actions, source, needsSetup } = useFieldData();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const on = status?.ingest.enabled ?? false;
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <Switch
        id={id}
        checked={on}
        disabled={busy || source === "loading" || needsSetup || !status}
        onCheckedChange={async (enabled) => {
          setBusy(true);
          setError(null);
          try {
            await actions.setAutoIngest(enabled);
          } catch (e) {
            setError(e instanceof Error ? e.message : "failed");
          } finally {
            setBusy(false);
          }
        }}
      />
      <label htmlFor={id} className="whitespace-nowrap">
        Auto ingest {on ? "on" : "off"}
      </label>
      {error ? <span className="text-[hsl(var(--danger-text))]">{error}</span> : null}
    </span>
  );
}

const TABS = [
  { href: "/field", label: "Review and actions" },
  { href: "/field/map", label: "Brain map" },
  { href: "/field/connect", label: "Connected tools" },
];

export function FieldTabs() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Agent workspace"
      className="inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-md bg-secondary p-0.5"
    >
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-7 shrink-0 items-center rounded-[5px] px-2.5 text-[13px] font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
              active && "bg-card text-foreground shadow-sm",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
