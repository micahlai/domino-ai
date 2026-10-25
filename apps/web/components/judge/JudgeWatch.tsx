"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Pause, Play } from "lucide-react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  SURPRISE_LABEL,
  SURPRISE_NEEDS,
  SURPRISE_PRESETS,
  type SurprisePreset,
  judgeStartOf,
} from "../../convex/lib/judge";
import { formatCents, formatDate } from "../../lib/format";
import { cn } from "../../lib/utils";
import { BrainMap } from "../field/BrainMap";
import { CrsCheck } from "../field/CrsCheck";
import { OpenInTimeline } from "../field/OpenInTimeline";
import { FieldCompanyOverride } from "../field/company";
import { FieldDataProvider } from "../field/data";
import { Button } from "../ui/button";
import { PageHeader } from "../ui/page";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "../ui/sheet";
import { CsvImport } from "./CsvImport";
import { SOURCE_TILE, storeJudgeCompany } from "./flow";
import { errorText } from "./shared";

// Step 3: the brain map for the judge's own company (it grows from the one root agent as the
// first ingest runs), beside a small panel: the verdict, the simulated clock, three preset
// surprises and reset. Every number comes from the backend; nothing is computed here.

type JudgeState = NonNullable<FunctionReturnType<typeof api.fieldJudge.state>>;

/** Clock speed for the judge's Play: about one simulated day per 1.2 s. */
const PLAY_SPEED = 5;

export function JudgeWatch({ state, onLeave }: { state: JudgeState; onLeave: () => void }) {
  const start = judgeStartOf(state.profile);
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={start ? `${state.name} · ${start.title}` : state.name}
        title={
          state.agentsStarted ? "Watch the agents read the books" : "Last step: start the agents"
        }
        description={
          !state.agentsStarted
            ? "Your company and tools are ready. Press Start agents on the map: one coordinator begins and calls in helpers as it reads each tool."
            : state.snapshotVersion > 0
              ? "One agent started the work and called in helpers. Hover any agent to see what it is doing."
              : "One agent is starting. It calls in helpers as it reads each tool."
        }
      />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <FieldCompanyOverride companyId={state.companyId} name={state.name}>
            <FieldDataProvider>
              <BrainMap embedded />
            </FieldDataProvider>
          </FieldCompanyOverride>
        </div>
        <SidePanel state={state} onLeave={onLeave} />
      </div>
    </div>
  );
}

function SidePanel({ state, onLeave }: { state: JudgeState; onLeave: () => void }) {
  const reset = useMutation(api.fieldJudge.reset);
  const leave = useMutation(api.fieldJudge.leave);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [csv, setCsv] = useState(false);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="order-first space-y-4 lg:order-none" aria-label="Your company">
      <Verdict companyId={state.companyId} />
      <Clock companyId={state.companyId} />
      <Surprises state={state} />
      {state.snapshotVersion > 0 ? (
        <div className="space-y-2 rounded-lg border bg-card p-4 shadow-xs">
          <p className="text-[13px] text-muted-foreground">
            Try your own events and questions on the forecast.
          </p>
          <FieldCompanyOverride companyId={state.companyId} name={state.name}>
            <OpenInTimeline variant="outline" label="Open in Timeline" />
          </FieldCompanyOverride>
        </div>
      ) : null}
      <CrsFlags companyId={state.companyId} />
      <div className="space-y-2 rounded-lg border bg-card p-4 shadow-xs">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const next = await reset({ companyId: state.companyId });
                storeJudgeCompany(next.companyId);
              })
            }
          >
            Reset
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await leave({ companyId: state.companyId });
                onLeave();
              })
            }
          >
            Pick another company
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-[13px] text-destructive">
            {error}
          </p>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            Reset starts a fresh copy with the same story and sources.
          </p>
        )}
        <button
          type="button"
          onClick={() => setCsv(true)}
          className="text-[13px] text-[hsl(var(--primary-ink))] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Bring your own data (CSV)
        </button>
      </div>
      <p className="px-1 text-xs leading-5 text-muted-foreground">
        Simulated company and tools. Real agents, audit and forecast.
      </p>
      <Sheet open={csv} onOpenChange={setCsv}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetTitle>Bring your own data</SheetTitle>
          <SheetDescription>
            Add bank lines, bills or invoices to {state.name}. The agents read them on the next
            ingest.
          </SheetDescription>
          <div className="mt-4">
            <CsvImport companyId={state.companyId} asOf={state.asOf} />
          </div>
        </SheetContent>
      </Sheet>
    </aside>
  );
}

function Verdict({ companyId }: { companyId: Id<"companies"> }) {
  const summary = useQuery(api.fieldDashboard.summary, { companyId });
  const view = summary?.result?.ok ? summary.result.view : null;
  const onTrack = view?.health.rating === "ok";
  return (
    <section className="rounded-lg border bg-card p-4 shadow-xs" aria-live="polite">
      <h2 className="text-[13px] text-muted-foreground">Next 13 weeks</h2>
      {view ? (
        <>
          <p
            className={cn(
              "mt-1 text-2xl font-semibold tracking-[-0.015em]",
              onTrack ? "text-safe" : "text-destructive",
            )}
          >
            {onTrack ? "On track" : "At risk"}
          </p>
          {view.lowest ? (
            <p className="mt-1 text-sm">
              Lowest cash{" "}
              <strong className="font-semibold tabular-nums">
                {formatCents(view.lowest.usable)}
              </strong>
              <span className="text-muted-foreground">
                , week of {formatDate(view.lowest.weekStart)}
              </span>
            </p>
          ) : null}
          {view.lenderMinimum ? (
            <p className="text-[13px] text-muted-foreground">
              Lender's minimum {formatCents(view.lenderMinimum.cents)}
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">
          {summary?.result && !summary.result.ok
            ? summary.result.message
            : "Reading the books. The forecast appears in a few seconds."}
        </p>
      )}
    </section>
  );
}

function Clock({ companyId }: { companyId: Id<"companies"> }) {
  const clock = useQuery(api.fieldClock.status, { companyId });
  const play = useMutation(api.fieldClock.play);
  const pause = useMutation(api.fieldClock.pause);
  const [error, setError] = useState<string | null>(null);
  if (!clock?.supported) return null;
  const playing = clock.status === "playing";
  const toggle = () => {
    setError(null);
    (playing ? pause({ companyId }) : play({ companyId, speed: PLAY_SPEED })).catch((e: unknown) =>
      setError(errorText(e)),
    );
  };
  const note =
    error ?? (!playing && clock.pausedReason ? `Paused: ${clock.pausedReason}` : null) ?? null;
  return (
    <section className="space-y-2 rounded-lg border bg-card p-4 shadow-xs">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[13px] text-muted-foreground">Simulated time</h2>
          <p className="text-sm font-semibold tabular-nums" aria-live="polite">
            {formatDate(clock.date)} <span className="font-normal">· Day {clock.day}</span>
          </p>
        </div>
        <Button
          size="sm"
          variant={playing ? "outline" : "default"}
          className="min-w-[84px]"
          onClick={toggle}
        >
          {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          {playing ? "Pause" : "Play"}
        </Button>
      </div>
      <p className={cn("text-[13px]", error ? "text-destructive" : "text-muted-foreground")}>
        {note ??
          "Play moves the company forward day by day; new entries arrive and the agents react."}
      </p>
    </section>
  );
}

function Surprises({ state }: { state: JudgeState }) {
  const surprise = useMutation(api.fieldJudge.surprise);
  const [busy, setBusy] = useState<SurprisePreset | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const ready = state.snapshotVersion > 0;
  const full = state.limits.usedThisMinute >= state.limits.perMinute;

  const add = async (preset: SurprisePreset) => {
    setBusy(preset);
    setResult(null);
    try {
      const r = await surprise({ companyId: state.companyId, preset });
      setResult({ ok: true, text: r.summary });
    } catch (e) {
      setResult({ ok: false, text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-2 rounded-lg border bg-card p-4 shadow-xs">
      <h2 className="text-[13px] text-muted-foreground">Add a surprise (optional)</h2>
      <ul className="space-y-2">
        {SURPRISE_PRESETS.map((p) => {
          const missing = SURPRISE_NEEDS[p].filter((t) => !state.sources.includes(t));
          return (
            <li key={p}>
              <button
                type="button"
                disabled={!ready || full || busy !== null || missing.length > 0}
                onClick={() => add(p)}
                className={cn(
                  "w-full rounded-md border px-3 py-2 text-left transition-colors",
                  "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent",
                )}
              >
                <span className="block text-sm font-medium">
                  {busy === p ? "Adding" : SURPRISE_LABEL[p].title}
                </span>
                <span className="block text-[13px] text-muted-foreground">
                  {missing.length > 0
                    ? `Needs ${missing.map((t) => SOURCE_TILE[t].name).join(" and ")} connected`
                    : SURPRISE_LABEL[p].detail}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {result ? (
        <p
          role={result.ok ? "status" : "alert"}
          className={cn("text-[13px]", result.ok ? "text-foreground" : "text-destructive")}
        >
          {result.ok ? `Added. ${result.text}. The agents are re-reading the books.` : result.text}
        </p>
      ) : !ready ? (
        <p className="text-[13px] text-muted-foreground">Ready once the first read finishes.</p>
      ) : full ? (
        <p className="text-[13px] text-muted-foreground">
          {state.limits.perMinute} a minute at most. Try again shortly.
        </p>
      ) : null}
    </section>
  );
}

/** Payment-change flags the identity and fraud agent checked with CRS, newest first. */
function CrsFlags({ companyId }: { companyId: Id<"companies"> }) {
  const open = useQuery(api.field.findings, { companyId, status: "open" });
  const checked = (open ?? []).filter((f) => f.crs).slice(0, 3);
  if (checked.length === 0) return null;
  return (
    <section
      aria-label="Identity and fraud checks"
      className="space-y-3 rounded-lg border bg-card p-4 shadow-xs"
    >
      <h2 className="text-sm font-medium">Payment changes checked with CRS</h2>
      {checked.map((f) =>
        f.crs ? (
          <div key={f.findingId}>
            <p className="text-[13px] leading-5">{f.summary.split(". ")[0]}</p>
            <CrsCheck crs={f.crs} />
          </div>
        ) : null,
      )}
    </section>
  );
}
