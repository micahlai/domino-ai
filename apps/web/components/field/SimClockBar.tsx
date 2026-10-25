"use client";

import { useMutation, useQuery } from "convex/react";
import { Clock3, Pause, Play, SkipForward } from "lucide-react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Segmented } from "../ui/segmented";
import { useIsReplayCompany, useSelectedCompany } from "./company";

// Simulated time for the selected company (convex/fieldClock.ts): a compact bar under the top
// bar on the dashboard and the Field pages. Play moves the mock world day by day; each day's
// new entries are ingested at once and the agents react, so every page updates live through
// its own queries. Hidden without a backend, for 2U (replayed filings) and for companies that
// only move by weeks.

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
const SPEEDS = [
  { value: "1", label: "1x" },
  { value: "5", label: "5x" },
  { value: "20", label: "20x" },
] as const;
type SpeedValue = (typeof SPEEDS)[number]["value"];

const ON = (p: string) => p === "/" || p === "/field" || p.startsWith("/field/map");

const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

export function SimClockBar({ pathname }: { pathname: string }) {
  if (!CONVEX_URL || !ON(pathname)) return null;
  return <LiveClockBar />;
}

function LiveClockBar() {
  const replay = useIsReplayCompany();
  const { companyId } = useSelectedCompany();
  if (replay || !companyId) return null;
  return <ClockControls companyId={companyId} />;
}

function ClockControls({ companyId }: { companyId: Id<"companies"> }) {
  const clock = useQuery(api.fieldClock.status, { companyId });
  const play = useMutation(api.fieldClock.play);
  const pause = useMutation(api.fieldClock.pause);
  const setSpeed = useMutation(api.fieldClock.setSpeed);
  const jump = useMutation(api.fieldClock.jump);
  const [error, setError] = useState<string | null>(null);
  if (!clock?.supported) return null;

  const run = (action: () => Promise<unknown>) => () => {
    setError(null);
    action().catch((e: unknown) => {
      const data = (e as { data?: { message?: string } }).data;
      setError(data?.message ?? (e instanceof Error ? e.message : "That did not work"));
    });
  };
  const playing = clock.status === "playing";
  const next = clock.nextEvent;
  const canJump = next !== null && next.inDays > 1 && !clock.ticking;
  const nextText =
    next === null
      ? "No scripted events left"
      : next.inDays <= 0
        ? "Next event today"
        : next.inDays === 1
          ? "Next event tomorrow"
          : `Next event in ${next.inDays} days`;
  const note = error ?? (!playing && clock.pausedReason ? `Paused: ${clock.pausedReason}` : null);
  // The log line reads "Day 5, 2026-11-04: ..."; the bar already shows the day and date.
  const latest = clock.lastSummary?.replace(/^Day \d+, \d{4}-\d{2}-\d{2}: /, "") ?? null;

  return (
    <div className="border-t bg-card">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 md:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Clock3 aria-hidden="true" className="size-3.5" />
            Simulated time
          </span>
          <span className="text-sm font-semibold tabular-nums" aria-live="polite">
            {longDate(clock.date)}
          </span>
          <span className="text-xs tabular-nums text-muted-foreground">Day {clock.day}</span>
          {playing ? (
            <span
              aria-hidden="true"
              className={cn(
                "size-1.5 rounded-full bg-foreground/70",
                clock.ticking && "motion-safe:animate-pulse",
              )}
            />
          ) : null}
        </div>
        <p
          className={cn(
            "min-w-0 flex-1 basis-64 truncate text-xs",
            error ? "text-destructive" : "text-muted-foreground",
          )}
          title={note ?? latest ?? undefined}
        >
          {note ?? latest ?? "Press play: each simulated day's entries arrive and the agents react"}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="text-xs text-muted-foreground"
            title={next ? `Day ${next.day}: ${next.title}` : undefined}
          >
            {nextText}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={!canJump}
            onClick={run(() => jump({ companyId }))}
            title={next ? `Move to day ${next.day - 1}, the day before the next event` : undefined}
          >
            <SkipForward aria-hidden="true" />
            Jump
          </Button>
          <Segmented
            label="Simulation speed"
            name="sim-speed"
            options={SPEEDS}
            value={String(clock.speed) as SpeedValue}
            onChange={(value) =>
              run(() => setSpeed({ companyId, speed: Number(value) as 1 | 5 | 20 }))()
            }
          />
          <Button
            size="sm"
            variant={playing ? "outline" : "default"}
            className="min-w-[84px]"
            onClick={run(() => (playing ? pause({ companyId }) : play({ companyId })))}
          >
            {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            {playing ? "Pause" : "Play"}
          </Button>
        </div>
      </div>
    </div>
  );
}
