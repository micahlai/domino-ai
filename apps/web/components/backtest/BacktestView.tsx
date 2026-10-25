"use client";

import { useMutation, useQueries } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { Eye, History, RotateCcw } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { cn } from "../../lib/utils";
import { formatCents } from "../field/dashboard/money";
import { type BaselineData, BaselineDataSchema, CASE_ID } from "../historical/live";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { PageHeader, Section } from "../ui/page";
import { Segmented } from "../ui/segmented";
import { Skeleton } from "../ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { BacktestChart, type ChartLine } from "./BacktestChart";

// 2U backtest from Nov 10, 2023. Steps 1 and 2 use only what was public at the cutoff (the saved
// baseline and the engine's ranked suggestions). Step 3 loads later figures only after the person
// presses Reveal. Step 4 is a simulated counterfactual built by the engine on the revealed actuals.
// This file formats backend cents; it never computes an amount.

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
export const COUNTERFACTUAL_LABEL = "Simulated counterfactual: illustrative, not a fact";

export type RunData = BaselineData;
export type SuggestionsData = FunctionReturnType<typeof api.backtest.getSuggestions>;
export type OutcomeData = FunctionReturnType<typeof api.backtest.getOutcome>;
type Suggestion = SuggestionsData["suggestions"][number];
type Prediction = {
  id: string;
  metric: string;
  kind: string;
  cents: number;
  period: { kind: string };
};

const USABLE = "cash_and_equivalents";
const TOTAL = "cash_including_restricted";
const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

const utc = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`);
export const day = (d: string) =>
  utc(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
const signed = (c: number) => (c > 0 ? `+${formatCents(c)}` : c === 0 ? "$0" : formatCents(c));
/** Exact dollars and cents for tables, display only. */
function exact(cents: number): string {
  const v = BigInt(cents);
  const a = v < 0n ? -v : v;
  const dollars = (a / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const rest = (a % 100n).toString().padStart(2, "0");
  return `${v < 0n ? "−" : ""}$${dollars}.${rest}`;
}
const pick = (ps: Prediction[], metric: string, kind?: string) =>
  ps.find((p) => p.metric === metric && (kind === undefined || p.kind === kind));
const instantDate = (p: { period: unknown }) => {
  const period = p.period as { kind: string; date?: string };
  return period.kind === "instant" ? (period.date ?? "") : "";
};

// ---------- Live wiring ----------

const STORE = "domino.2u.backtest.v1";
type Stored = { requestId: string; runId?: string };
const newRequestId = () => `backtest-${crypto.randomUUID().replaceAll("-", "")}`.slice(0, 48);

function readStored(): Stored | null {
  try {
    const raw = window.localStorage.getItem(STORE);
    const v = raw ? (JSON.parse(raw) as Partial<Stored>) : null;
    return v && typeof v.requestId === "string"
      ? { requestId: v.requestId, ...(typeof v.runId === "string" ? { runId: v.runId } : {}) }
      : null;
  } catch {
    return null;
  }
}
function writeStored(s: Stored) {
  try {
    window.localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    // Storage blocked: the backtest still works for this visit.
  }
}
function errorText(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data as { message?: unknown } | undefined;
    if (data && typeof data.message === "string") return data.message;
  }
  return "Could not reach the history backend. Check the connection and try again.";
}
const codeOf = (e: unknown) =>
  e instanceof ConvexError ? (e.data as { code?: unknown } | undefined)?.code : undefined;

/** This browser's saved baseline, saved once per requestId so a retry never saves twice. */
function useBaselineRun() {
  const [stored, setStored] = useState<Stored | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const save = useMutation(api.historical.saveBaseline);
  useEffect(() => {
    const s = readStored() ?? { requestId: newRequestId() };
    writeStored(s);
    setStored(s);
  }, []);
  useEffect(() => {
    if (!stored || stored.runId || saving.current) return;
    saving.current = true;
    setError(null);
    save({ requestId: stored.requestId, caseId: CASE_ID })
      .then((summary) => {
        const next = { ...stored, runId: (summary as { runId: string }).runId };
        writeStored(next);
        setStored(next);
      })
      .catch((e: unknown) => setError(errorText(e)))
      .finally(() => {
        saving.current = false;
      });
  }, [stored, save]);
  const restart = useCallback(() => {
    const s = { requestId: newRequestId() };
    writeStored(s);
    setStored(s);
  }, []);
  return { runId: stored?.runId, error, restart };
}

export function BacktestView() {
  if (!CONVEX_URL)
    return (
      <Frame>
        <Header />
        <Notice title="The 2U backtest needs the history backend" tone="danger">
          2U is replayed from its public filings, which live in the backend. This environment is not
          connected to it, so nothing is shown rather than sample numbers.
        </Notice>
      </Frame>
    );
  return <LiveBacktest />;
}

function LiveBacktest() {
  const { runId, error: saveError, restart } = useBaselineRun();
  const [revealed, setRevealed] = useState(false);
  const raw = useQueries(
    useMemo(
      () =>
        runId
          ? {
              run: { query: api.historical.getRun, args: { caseId: CASE_ID, runId } },
              suggestions: { query: api.backtest.getSuggestions, args: { caseId: CASE_ID, runId } },
              reveal: { query: api.historical.getReveal, args: { runId } },
              // Later figures are requested only once this run's reveal record exists.
              ...(revealed
                ? { outcome: { query: api.backtest.getOutcome, args: { caseId: CASE_ID, runId } } }
                : {}),
            }
          : {},
      [runId, revealed],
    ),
  );
  const revealRecord = raw.reveal;
  useEffect(() => {
    setRevealed(Boolean(revealRecord) && !(revealRecord instanceof Error));
  }, [revealRecord]);

  // A saved run the backend no longer knows (reset database) or an outdated case: start over.
  const stale = [raw.run, raw.suggestions].some(
    (x) => codeOf(x) === "NOT_FOUND" || codeOf(x) === "CASE_CHANGED",
  );
  useEffect(() => {
    if (stale) restart();
  }, [stale, restart]);

  const doReveal = useMutation(api.historical.reveal);
  const revealIds = useRef<Record<string, string>>({});
  const [act, setAct] = useState<{ pending?: boolean; error?: string }>({});
  const onReveal = () => {
    if (!runId || act.pending) return;
    revealIds.current[runId] ??= newRequestId();
    setAct({ pending: true });
    doReveal({ requestId: revealIds.current[runId], runId })
      .then(() => setAct({}))
      .catch((e: unknown) => setAct({ error: errorText(e) }));
  };
  const onRestart = () => {
    setAct({});
    setRevealed(false);
    restart();
  };

  const failed = [raw.run, raw.suggestions, raw.reveal, raw.outcome].find(
    (x): x is Error => x instanceof Error,
  );
  if (saveError || (failed && !stale))
    return (
      <Frame>
        <Header />
        <Notice title="The 2U backtest could not load" tone="danger">
          {saveError ?? errorText(failed)} Nothing was changed.
        </Notice>
      </Frame>
    );
  if (!runId || raw.run === undefined || raw.suggestions === undefined || raw.reveal === undefined)
    return <BacktestScreen state={{ kind: "loading" }} />;
  const run = BaselineDataSchema.safeParse(raw.run);
  if (!run.success)
    return (
      <Frame>
        <Header />
        <Notice title="The saved forecast was not in the expected shape" tone="danger">
          Nothing is shown rather than guessing. Nothing was changed.
        </Notice>
      </Frame>
    );
  return (
    <BacktestScreen
      state={{
        kind: "ready",
        run: run.data,
        suggestions: raw.suggestions as SuggestionsData,
        outcome: raw.reveal ? (raw.outcome as OutcomeData | undefined) : null,
        act,
        onReveal,
        onRestart,
      }}
    />
  );
}

// ---------- Screen (pure, rendered in tests) ----------

export type ScreenState =
  | { kind: "loading" }
  | {
      kind: "ready";
      run: RunData;
      suggestions: SuggestionsData;
      /** null before the reveal; undefined while the revealed outcome loads. */
      outcome: OutcomeData | null | undefined;
      act: { pending?: boolean; error?: string };
      onReveal: () => void;
      onRestart: () => void;
      /** Step 4 choice; defaults to the top-ranked modeled suggestion. */
      selected?: string;
    };

export function BacktestScreen({ state }: { state: ScreenState }) {
  const [choice, setChoice] = useState<string | undefined>(undefined);
  if (state.kind === "loading")
    return (
      <Frame>
        <Header />
        <div className="space-y-4" aria-busy="true">
          <p className="text-sm text-muted-foreground">
            Loading 2U's filings as of Nov 10, 2023...
          </p>
          <Skeleton className="h-80 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-lg" />
        </div>
      </Frame>
    );
  const { run, suggestions: sd, outcome } = state;
  const modeled = sd.suggestions.filter((s) => s.rank !== null && s.kind !== "keep_plan");
  const selectedId = choice ?? state.selected ?? modeled[0]?.id;
  const selected = sd.suggestions.find((s) => s.id === selectedId);
  const counterfactual = outcome?.counterfactuals.find((c) => c.suggestionId === selectedId);
  return (
    <Frame>
      <Header
        actions={
          <Button variant="outline" size="sm" onClick={state.onRestart}>
            <RotateCcw aria-hidden="true" />
            Start over
          </Button>
        }
      />
      <Section
        title="Cash timeline, usable cash by quarter"
        description={
          outcome
            ? "Forecast frozen on Nov 10, 2023, what 2U later reported, and the simulated counterfactual."
            : "Forecast frozen on Nov 10, 2023. What actually happened stays hidden until Step 3."
        }
      >
        <BacktestChart
          cutoff={sd.knowledgeCutoff.slice(0, 10)}
          quarterLabels={[
            { date: run.run.originBalanceDate, label: "Q3 2023 end" },
            { date: "2023-12-31", label: "Q4 2023 end" },
          ]}
          lines={chartLines(run, outcome ?? null, selected, counterfactual)}
        />
      </Section>
      <StepKnew run={run} />
      <StepSuggest sd={sd} run={run} />
      <StepActual state={state} />
      {outcome ? (
        <StepCounterfactual
          outcome={outcome}
          sd={sd}
          modeled={modeled}
          selectedId={selectedId}
          onSelect={setChoice}
        />
      ) : (
        <Section title="Step 4 · If they had followed our suggestion">
          <p className="text-sm leading-6 text-muted-foreground">
            Available after Step 3. The counterfactual is built on what actually happened, so it
            needs the reveal first.
          </p>
        </Section>
      )}
      <p className="max-w-3xl text-[13px] leading-5 text-muted-foreground">
        <span className="font-medium text-foreground">About this backtest.</span> {sd.disclosure}{" "}
        Method {sd.method.id} v{sd.method.version} on saved run {run.runId}.
      </p>
    </Frame>
  );
}

function chartLines(
  run: RunData,
  outcome: OutcomeData | null,
  selected: Suggestion | undefined,
  cf: OutcomeData["counterfactuals"][number] | undefined,
): ChartLine[] {
  // F01 is the case's reported usable cash at the origin date (its usableCashFactId role).
  const origin = run.inputSnapshot.facts.find((f) => f.id === "F01");
  const start = origin
    ? [{ date: run.run.originBalanceDate, cents: origin.cents, reported: true }]
    : [];
  const preds = run.run.predictions as Prediction[];
  const forecast: ChartLine = {
    id: "forecast",
    label: "Forecast (frozen Nov 10, 2023)",
    points: [
      ...start,
      ...[pick(preds, USABLE, "nowcast"), pick(preds, USABLE, "forecast")].flatMap((p) =>
        p ? [{ date: instantDate(p), cents: p.cents, reported: false }] : [],
      ),
    ],
  };
  if (!outcome) return [forecast];
  const actualEnd = outcome.comparisons.find(
    (c) => c.status === "scored" && c.predictionId === pick(preds, USABLE, "forecast")?.id,
  );
  const usableCf = cf?.points.find((p) => p.metric === USABLE);
  const actualCents =
    usableCf?.actualCents ?? (actualEnd?.status === "scored" ? actualEnd.observedCents : undefined);
  const lines: ChartLine[] = [forecast];
  if (actualCents !== undefined)
    lines.push({
      id: "actual",
      label: "Actual (reported later)",
      points: [...start, { date: "2023-12-31", cents: actualCents, reported: true }],
    });
  if (usableCf && selected)
    lines.unshift({
      id: "counterfactual",
      label: `Counterfactual: ${selected.title.toLowerCase()} (simulated)`,
      points: [
        ...start,
        { date: usableCf.date, cents: usableCf.counterfactualCents, reported: false },
      ],
    });
  return lines;
}

// ---------- Step 1 ----------

function StepKnew({ run }: { run: RunData }) {
  const preds = run.run.predictions as Prediction[];
  const snap = run.inputSnapshot;
  const now = pick(preds, USABLE, "nowcast");
  const end = pick(preds, USABLE, "forecast");
  const endTotal = pick(preds, TOTAL, "forecast");
  const fact = (id: string) => snap.facts.find((f) => f.id === id);
  const label: Record<string, string> = {
    F01: "Usable cash (cash and equivalents)",
    F02: "Restricted cash",
    F03: "Cash including restricted cash",
    F05: "Operating cash flow, first nine months",
    F06: "Investing cash flow, first nine months",
    F07: "Financing cash flow, first nine months",
    F08: "Exchange-rate effect, first nine months",
  };
  return (
    <Section
      title="Step 1 · What we knew on Nov 10, 2023"
      description="The quarterly forecast Domino froze from facts public by the cutoff. Nothing published later was used."
    >
      <div className="space-y-4">
        <p className="max-w-3xl text-[15px] leading-6">
          At the nine-month pace, usable cash goes from{" "}
          <strong>{formatCents(fact("F01")?.cents ?? 0)}</strong> on Sep 30, 2023 to about{" "}
          <strong>{formatCents(now?.cents ?? 0)}</strong> on Nov 10 and{" "}
          <strong>{formatCents(end?.cents ?? 0)}</strong> by Dec 31, 2023 (
          {formatCents(endTotal?.cents ?? 0)} including restricted cash).
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Input</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {snap.facts.map((f) => {
              const s = snap.sources.find((x) => x.id === (f as { sourceId?: string }).sourceId);
              return (
                <TableRow key={f.id}>
                  <TableCell>
                    {label[f.id] ?? f.metric}{" "}
                    <span className="text-muted-foreground">({f.id})</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{exact(f.cents)}</TableCell>
                  <TableCell>
                    {s ? (
                      <a href={s.url} className={cn("text-primary underline", focusRing)}>
                        {s.title}
                      </a>
                    ) : (
                      "Derived"
                    )}
                    {s ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · published {day(s.publishedAt)}
                      </span>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground">
          <li>Operating and investing flow per quarter = nine-month flow divided by three.</li>
          {snap.assumptions.map((a) => (
            <li key={a.id}>
              {a.id}: {a.description}
            </li>
          ))}
        </ul>
        <p className="text-[13px] text-muted-foreground">
          Saved run {run.runId}, input hash {run.run.inputHash.slice(0, 12)}, method{" "}
          {run.run.method.id} v{run.run.method.version}.
        </p>
      </div>
    </Section>
  );
}

// ---------- Step 2 ----------

function describeSuggestion(s: Suggestion, base: number | undefined): string {
  if (s.kind === "keep_plan") return "The saved forecast with no change.";
  if (s.kind === "credit_draw" && s.amountCents !== null)
    return `Borrow the undrawn ${formatCents(s.amountCents)} on ${day(s.effectiveFrom ?? "")}. Assumes the lender would still allow it (conditions were not read). Interest and fees not modeled; the loan must be repaid later.`;
  if (s.kind === "costed" && s.oneTimeCostCents && s.benefit)
    return `One-time cost of ${formatCents(s.oneTimeCostCents.low)} to ${formatCents(s.oneTimeCostCents.high)} paid ${day(s.effectiveFrom ?? "")}. Savings start ${day(s.benefit.start)}${s.benefit.daysInQuarter === 0 ? ", after the quarter, so none count by Dec 31" : ""}. Feasibility unknown.`;
  return s.reason ?? (base === undefined ? "" : "Not modeled.");
}

function StepSuggest({ sd, run }: { sd: SuggestionsData; run: RunData }) {
  const base = pick(run.run.predictions as Prediction[], USABLE, "forecast")?.cents;
  const top = sd.suggestions.find((s) => s.rank === 1);
  const cut = sd.suggestions.find((s) => s.kind === "costed");
  const topEnd = top ? pick(top.forecast as Prediction[], USABLE)?.cents : undefined;
  const cutEnd = cut ? pick(cut.forecast as Prediction[], USABLE)?.cents : undefined;
  const sourceOf = (id: string) => {
    const f = sd.facts.find((x) => x.id === id) ?? sd.notes.find((x) => x.id === id);
    return f ? sd.sources.find((s) => s.id === f.sourceId) : undefined;
  };
  return (
    <Section
      title="Step 2 · What Domino would have suggested then"
      description="Each response is computed by the engine against the saved forecast, using only facts public by Nov 10, 2023, and ranked by usable cash on Dec 31, 2023."
    >
      <div className="space-y-4">
        <div className="max-w-3xl space-y-1">
          <p className="text-[15px] leading-6">
            {top && topEnd !== undefined && base !== undefined
              ? `Top suggestion: ${top.title.toLowerCase()}. It is the only modeled response that raises quarter-end cash, from ${formatCents(base)} to ${formatCents(topEnd)}.`
              : null}{" "}
            {cut && cutEnd !== undefined
              ? `The cost cut lowers Dec 31 cash to ${formatCents(cutEnd)} because its cost lands now and its savings start after the quarter.`
              : null}{" "}
            Refinancing could not be computed: no terms were public.
          </p>
          <p className="text-[13px] text-muted-foreground">
            Summary written by a fixed template from the engine numbers above. AI rationale:
            skipped, no provider is called for this view.
          </p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">Rank</TableHead>
              <TableHead>Response</TableHead>
              <TableHead className="text-right">Usable cash, Dec 31</TableHead>
              <TableHead className="text-right">vs forecast</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sd.suggestions.map((s) => {
              const end = pick(s.forecast as Prediction[], USABLE);
              return (
                <TableRow key={s.id} data-suggestion={s.id}>
                  <TableCell className="tabular-nums">{s.rank ?? "–"}</TableCell>
                  <TableCell className="max-w-xl whitespace-normal">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      {s.title}
                      {s.rank === 1 ? <Badge variant="success">Top suggestion</Badge> : null}
                      {s.rank === null ? <Badge variant="secondary">Not ranked</Badge> : null}
                    </div>
                    <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">
                      {describeSuggestion(s, base)}
                      {s.basisIds
                        .filter((id) => sourceOf(id))
                        .map((id) => {
                          const src = sourceOf(id)!;
                          return (
                            <span key={id}>
                              {" "}
                              Basis {id}:{" "}
                              <a href={src.url} className={cn("text-primary underline", focusRing)}>
                                {src.title}
                              </a>{" "}
                              ({day(src.publishedAt)}).
                            </span>
                          );
                        })}
                    </p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {end ? formatCents(end.cents) : "Not computed"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s.effectCents
                      ? s.effectCents.low === s.effectCents.high
                        ? signed(s.effectCents.point)
                        : `${signed(s.effectCents.point)} (${signed(s.effectCents.low)} to ${signed(s.effectCents.high)})`
                      : "–"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {sd.facts.length ? (
          <p className="text-[13px] leading-5 text-muted-foreground">
            Credit facility facts:{" "}
            {sd.facts
              .map((f) => `${f.id} ${f.label} ${formatCents(f.cents)} on ${day(f.date)}`)
              .join("; ")}
            . {sd.sources.find((s) => s.id === "S1")?.verification}
          </p>
        ) : null}
      </div>
    </Section>
  );
}

// ---------- Step 3 ----------

const FLOW_LABEL: Record<string, string> = {
  operating_cash_flow: "Operating cash flow",
  investing_cash_flow: "Investing cash flow",
  financing_cash_flow: "Financing cash flow",
  fx_effect_on_cash: "Exchange-rate effect",
};

function StepActual({ state }: { state: Extract<ScreenState, { kind: "ready" }> }) {
  const { outcome, act, run } = state;
  if (outcome === null)
    return (
      <Section
        title="Step 3 · What actually happened"
        description="Hidden until you reveal it. Nothing published after Nov 10, 2023 has been loaded."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={state.onReveal} disabled={act.pending}>
            <Eye aria-hidden="true" />
            {act.pending ? "Revealing..." : "Reveal what actually happened"}
          </Button>
          <span className="text-sm text-muted-foreground">
            Loads 2U's next filing after the cutoff and scores the frozen forecast against it.
          </span>
          {act.error ? (
            <span role="alert" className="text-sm text-destructive">
              {act.error}
            </span>
          ) : null}
        </div>
      </Section>
    );
  if (outcome === undefined)
    return (
      <Section title="Step 3 · What actually happened">
        <Skeleton className="h-40 w-full rounded-lg" />
      </Section>
    );
  const preds = run.run.predictions as Prediction[];
  const metricName = (m: string) =>
    m === USABLE ? "Usable cash" : m === TOTAL ? "Cash including restricted" : m;
  const s8 = outcome.sources[0];
  return (
    <Section
      title="Step 3 · What actually happened"
      description={`Revealed through ${day(outcome.revealedThrough)}. Actual reported figures beside the frozen forecast.`}
    >
      <div className="space-y-5">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Quarter</TableHead>
              <TableHead>Measure</TableHead>
              <TableHead className="text-right">Forecast</TableHead>
              <TableHead className="text-right">Actual</TableHead>
              <TableHead className="text-right">Error (actual − forecast)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {outcome.comparisons.map((c) => {
              const p = preds.find((x) => x.id === c.predictionId);
              if (!p) return null;
              const when =
                p.kind === "nowcast" ? "Nov 10, 2023 (cutoff)" : "Q4 2023 (Oct 1 to Dec 31)";
              return (
                <TableRow key={c.id}>
                  <TableCell>{when}</TableCell>
                  <TableCell>{metricName(p.metric)}</TableCell>
                  <TableCell className="text-right tabular-nums">{exact(p.cents)}</TableCell>
                  {c.status === "scored" ? (
                    <>
                      <TableCell className="text-right tabular-nums">
                        {exact(c.observedCents)}{" "}
                        <span className="text-muted-foreground">({c.observationFactId})</span>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {c.errorCents > 0 ? "+" : ""}
                        {exact(c.errorCents)}
                      </TableCell>
                    </>
                  ) : (
                    <TableCell colSpan={2} className="text-right text-muted-foreground">
                      Not scored: no reported balance on that date
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div>
          <h3 className="mb-2 text-sm font-medium">Why the forecast missed, Q4 2023 cash flows</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Flow</TableHead>
                <TableHead className="text-right">Assumed at cutoff</TableHead>
                <TableHead className="text-right">Actual</TableHead>
                <TableHead className="text-right">Difference</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {outcome.flows.map((f) => (
                <TableRow key={f.metric}>
                  <TableCell>{FLOW_LABEL[f.metric] ?? f.metric}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {exact(f.forecastCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {f.actualCents === null ? "–" : exact(f.actualCents)}{" "}
                    {f.actualFactId ? (
                      <span className="text-muted-foreground">({f.actualFactId})</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {f.errorCents === null
                      ? "–"
                      : `${f.errorCents > 0 ? "+" : ""}${exact(f.errorCents)}`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
            Q4 flows are derived: full-year 2023 minus the first nine months, same statements.
            Operating cash turned positive in Q4 and financing brought cash in; the nine-month pace
            and the zero-financing assumption missed both.
          </p>
        </div>
        <ul className="space-y-1 text-[13px] leading-5 text-muted-foreground">
          {s8 ? (
            <li>
              Source:{" "}
              <a href={s8.url} className={cn("text-primary underline", focusRing)}>
                {s8.title}
              </a>{" "}
              (published {day(s8.publishedAt)}). {s8.verification}
            </li>
          ) : null}
          {outcome.facts.map((f) => (
            <li key={f.id}>
              {f.id}: {f.label} {formatCents(f.cents)} on {day(f.date)}. {f.locator}
            </li>
          ))}
        </ul>
        <div className="rounded-lg border bg-muted/40 p-3 text-sm leading-6">
          <span className="font-medium">Later, outside this backtest:</span> {outcome.epilogue.text}{" "}
          <a href={outcome.epilogue.url} className={cn("text-primary underline", focusRing)}>
            Source: {outcome.epilogue.title}
          </a>
          . <span className="text-muted-foreground">{outcome.epilogue.verification}</span>
        </div>
      </div>
    </Section>
  );
}

// ---------- Step 4 ----------

function StepCounterfactual({
  outcome,
  sd,
  modeled,
  selectedId,
  onSelect,
}: {
  outcome: OutcomeData;
  sd: SuggestionsData;
  modeled: Suggestion[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  const cf = outcome.counterfactuals.find((c) => c.suggestionId === selectedId);
  const s = sd.suggestions.find((x) => x.id === selectedId);
  return (
    <Section
      title="Step 4 · If they had followed our suggestion"
      description="Actual reported path plus the engine-computed effect of the chosen suggestion, applied from the cutoff."
    >
      <div className="space-y-4">
        <Badge variant="warning" className="text-[13px]">
          {COUNTERFACTUAL_LABEL}
        </Badge>
        <Segmented
          label="Suggestion to simulate"
          name="backtest-suggestion"
          options={modeled.map((m) => ({ value: m.id, label: `#${m.rank} ${m.title}` }))}
          value={selectedId ?? ""}
          onChange={onSelect}
        />
        {cf && s ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dec 31, 2023</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead className="text-right">Counterfactual (simulated)</TableHead>
                  <TableHead className="text-right">Difference</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cf.points.map((p) => (
                  <TableRow key={p.metric}>
                    <TableCell>
                      {p.metric === USABLE ? "Usable cash" : "Cash including restricted"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {exact(p.actualCents)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {exact(p.counterfactualCents)}
                      {p.counterfactualRange ? (
                        <span className="block text-[12px] font-normal text-muted-foreground">
                          range {exact(p.counterfactualRange.low)} to{" "}
                          {exact(p.counterfactualRange.high)}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {signed(p.counterfactualCents - p.actualCents)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div>
              <h3 className="mb-1 text-sm font-medium">Assumptions, stated plainly</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground">
                {assumptionLines(s, cf, outcome, sd).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No modeled suggestion to simulate.</p>
        )}
      </div>
    </Section>
  );
}

function assumptionLines(
  s: Suggestion,
  cf: OutcomeData["counterfactuals"][number],
  outcome: OutcomeData,
  sd: SuggestionsData,
): string[] {
  const commitment = sd.facts.find((f) => f.metric === "revolver_commitment");
  const drawn = sd.facts.find((f) => f.metric === "revolver_drawn");
  const lines: string[] = [
    "Starts from what 2U actually reported on Dec 31, 2023; everything 2U actually did stays in.",
  ];
  if (s.kind === "credit_draw" && s.amountCents !== null) {
    const after = outcome.facts.find((f) => cf.overlapFactIds.includes(f.id));
    lines.push(
      `Suggestion: borrow the undrawn ${formatCents(s.amountCents)} of the ${commitment ? formatCents(commitment.cents) : ""} credit facility on ${day(s.effectiveFrom ?? "")} (facility size and amount drawn from the 10-Q: ${s.basisIds.join(", ")}).`,
    );
    if (cf.overlapCents > 0)
      lines.push(
        `2U did this anyway: borrowings were ${after ? formatCents(after.cents) : "the full facility"} on Dec 31, 2023 (${after?.id ?? "S8"}), up from ${drawn ? formatCents(drawn.cents) : "the Sep 30 amount"}. So ${formatCents(cf.overlapCents)} of the suggestion is already in the actual figures and is not added twice. The timing of 2U's own draw is not in the data.`,
      );
    lines.push("Interest and fees on the draw are not modeled.");
  }
  if (s.kind === "costed" && s.oneTimeCostCents && s.benefit)
    lines.push(
      `Suggestion: a second cost action costing ${formatCents(s.oneTimeCostCents.low)} to ${formatCents(s.oneTimeCostCents.high)} on ${day(s.effectiveFrom ?? "")}; the middle of that range is used. Savings start ${day(s.benefit.start)}, after the quarter, so none are counted. Assumes 2U did not already take this action; the case data does not say either way.`,
    );
  lines.push(
    `Applied effect on Dec 31 cash: ${signed(cf.appliedEffectCents.point)}. One quarter of cash cannot show whether any suggestion would have changed 2U's later restructuring; this does not claim it would have prevented the Chapter 11 filing.`,
  );
  return lines;
}

// ---------- Frame ----------

function Frame({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-[1100px] space-y-8 p-4 md:p-6">{children}</div>;
}

function Header({ actions }: { actions?: ReactNode }) {
  return (
    <PageHeader
      eyebrow={
        <span className="flex flex-wrap items-center gap-2">
          2U · Backtest from Nov 2023 (real history)
          <Badge variant="secondary" className="font-normal">
            <History aria-hidden="true" />
            Backtest: Nov 2023
          </Badge>
        </span>
      }
      title="2U backtest: forecast, suggestion, reality"
      description="Test Domino from the past. Freeze what was known on Nov 10, 2023, see what Domino would have suggested, reveal what 2U actually reported, then simulate the suggestion on the real path."
      actions={actions}
    />
  );
}

function Notice({
  title,
  tone = "neutral",
  children,
}: {
  title: string;
  tone?: "neutral" | "danger";
  children: ReactNode;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "rounded-lg border p-4",
        tone === "danger" ? "border-destructive/40 bg-destructive/5" : "bg-card",
      )}
    >
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
