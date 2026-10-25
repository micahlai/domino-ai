"use client";

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

/**
 * Says where the numbers come from, the same way on every page. "Demo data" appears only when
 * no backend is configured; with a backend the page shows live numbers or an error, never demo.
 */
export function SourceBadge({
  source,
  note,
  className,
}: { source: "live" | "demo" | "loading"; note?: string; className?: string }) {
  if (source === "live")
    return (
      <Badge variant="success" className={cn("gap-1.5", className)}>
        <span aria-hidden="true" className="size-1.5 rounded-full bg-safe" />
        Reconstructed feed
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
      title={note}
      className={cn("gap-1.5 border-dashed font-normal text-muted-foreground", className)}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-clay" />
      Demo data
      {note ? <span className="sr-only">: {note}</span> : null}
    </Badge>
  );
}

/** SourceBadge for the pages that read the field.* data provider. */
export function DataLabel({ className }: { className?: string }) {
  const { source, sourceNote } = useFieldData();
  return <SourceBadge source={source} note={sourceNote} className={className} />;
}

/** "Plant an anomaly" choice for the next "New entries arrive". Empty means plain new entries. */
export function AnomalyPicker({
  value,
  onChange,
  disabled,
  stacked = false,
}: {
  value: Anomaly | "";
  onChange: (value: Anomaly | "") => void;
  disabled?: boolean;
  /** Label above a full-width select (a narrow panel), instead of one inline row. */
  stacked?: boolean;
}) {
  const id = useId();
  return (
    <span
      className={cn(
        "min-w-0 text-sm",
        stacked ? "flex flex-col gap-1.5" : "inline-flex items-center gap-2",
      )}
    >
      <label
        htmlFor={id}
        className={stacked ? "text-[13px] font-medium" : "shrink-0 text-muted-foreground"}
      >
        {stacked ? "Plant an anomaly" : "With"}
      </label>
      <Select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as Anomaly | "")}
        className={stacked ? "h-11 w-full sm:h-9" : "max-sm:h-11 sm:w-56"}
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
    <span className="inline-flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
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
        Auto checks {on ? "on" : "off"}
      </label>
      {error ? <span className="text-[hsl(var(--danger-text))]">{error}</span> : null}
    </span>
  );
}
