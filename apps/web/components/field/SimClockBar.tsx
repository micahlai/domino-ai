"use client";

import { useMutation, useQuery } from "convex/react";
import { Clock3, Pause, Play, SkipForward } from "lucide-react";
import { useId, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Segmented } from "../ui/segmented";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { useSelectedCompany } from "./company";

// Simulated time for the selected company (convex/fieldClock.ts): a compact control group in the
// page context row on the dashboard and the Field pages. Play moves the mock world day by day; each day's
// new entries are ingested at once and the agents react, so every page updates live through
// its own queries. Hidden without a backend and for companies that only move by weeks.

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
const SPEEDS = [
  { value: "1", label: "1x" },
  { value: "5", label: "5x" },
  { value: "20", label: "20x" },
] as const;
type SpeedValue = (typeof SPEEDS)[number]["value"];

export const PAUSE_HINT = "Pause stops new days; work already queued may finish.";
const PLAY_HINT = "Play moves the simulated world one day at a time; the agents react to each day.";

const ON = (p: string) => p === "/" || p === "/field" || p.startsWith("/field/");

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
  const { companyId } = useSelectedCompany();
  if (!companyId) return null;
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
  return (
    <SimClockView
      clock={clock}
      error={error}
      onToggle={run(() =>
        clock.status === "playing" ? pause({ companyId }) : play({ companyId }),
      )}
      onSpeed={(speed) => run(() => setSpeed({ companyId, speed }))()}
      onJump={run(() => jump({ companyId }))}
    />
  );
}

export interface ClockState {
  date: string;
  day: number;
  speed: number;
  status: string;
  ticking: boolean;
  pausedReason: string | null;
  nextEvent: { day: number; inDays: number; title: string } | null;
}

/** Props-only clock controls, also shown in the playground. */
export function SimClockView({
  clock,
  error,
  onToggle,
  onSpeed,
  onJump,
}: {
  clock: ClockState;
  error: string | null;
  onToggle: () => void;
  onSpeed: (speed: 1 | 5 | 20) => void;
  onJump: () => void;
}) {
  const hintId = useId();
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

  return (
    <fieldset className="flex min-w-0 flex-wrap items-center gap-2 max-sm:w-full">
      <legend className="sr-only">Simulated time</legend>
      <div className="mr-1 flex min-w-0 items-center gap-2 text-[13px] leading-5">
        <Clock3 aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className="sr-only">Simulated date</span>
        <span className="font-medium tabular-nums" aria-live="polite">
          {longDate(clock.date)}
        </span>
        <span className="tabular-nums text-muted-foreground">Day {clock.day}</span>
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
      <Segmented
        label="Simulation speed"
        name="sim-speed"
        options={SPEEDS}
        value={String(clock.speed) as SpeedValue}
        onChange={(value) => onSpeed(Number(value) as 1 | 5 | 20)}
        className="max-sm:[&_span]:h-10"
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant={playing ? "outline" : "default"}
            className="min-w-[84px]"
            aria-describedby={hintId}
            onClick={onToggle}
          >
            {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            {playing ? "Pause" : "Play"}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{playing ? PAUSE_HINT : PLAY_HINT}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* A span keeps the tooltip reachable while Jump is disabled. */}
          <span tabIndex={canJump ? undefined : 0} className="inline-flex rounded-md">
            <Button variant="outline" size="sm" disabled={!canJump} onClick={onJump}>
              <SkipForward aria-hidden="true" />
              Jump
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {next ? `${nextText}: ${next.title}. Jump moves to the day before it.` : nextText}
        </TooltipContent>
      </Tooltip>
      <span id={hintId} className="sr-only">
        {PAUSE_HINT}
      </span>
      {note ? (
        <p
          role={error ? "alert" : undefined}
          className={cn(
            "min-w-0 basis-full text-xs leading-4",
            error ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {note}
        </p>
      ) : null}
    </fieldset>
  );
}
