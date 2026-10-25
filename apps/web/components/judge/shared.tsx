"use client";

import { ConvexError } from "convex/values";
import { useEffect, useState } from "react";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";

/** Plain message from a failed Convex call (ConvexError data.message), else a generic line. */
export function errorText(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data as { message?: unknown } | string;
    if (typeof data === "string") return data;
    if (typeof data?.message === "string") return data.message;
  }
  return "Something went wrong. Try again.";
}

/** "Simulated data" or "Real" with what is real. Every judge panel carries one. */
export function ProofLabel({ kind, children }: { kind: "simulated" | "real"; children?: string }) {
  return kind === "simulated" ? (
    <Badge variant="warning" title="Synthetic records from the simulator, never a real company">
      {children ?? "Simulated data"}
    </Badge>
  ) : (
    <Badge variant="outline" title="The production code path, running for real on this data">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-foreground" />
      {children ?? "Real"}
    </Badge>
  );
}

export const shortDay = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

export const clockTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

/** Seconds since `iso`, refreshed every second, for "updated 3 s ago". */
export function useSecondsSince(iso: string | null | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isNaN(at) ? null : Math.max(0, Math.round((now - at) / 1000));
}

export function ago(seconds: number | null): string {
  if (seconds === null) return "never";
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds} s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  return `${Math.round(seconds / 3600)} h ago`;
}

export function FieldLabel({
  htmlFor,
  children,
  className,
}: {
  htmlFor: string;
  children: string;
  className?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn("text-[13px] font-medium text-muted-foreground", className)}
    >
      {children}
    </label>
  );
}
