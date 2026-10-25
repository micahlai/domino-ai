"use client";

import type { Change, Constraint, WeeklyResultRefV1 } from "@domino/contracts";
import {
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  ShieldAlert,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useId, useMemo, useState } from "react";
import { scenarioStart } from "../../../convex/timeline/scenarioStart";
import { timelineCalculationHref } from "../../../lib/trace-links";
import { Button } from "../../ui/button";
import { StatTile } from "../../ui/page";
import { analysisHref } from "../analysis/links";
import { formatExactCents, formatFullDate, formatSavedAt } from "../baseline/format";
import { Assistant, type AssistantTab, useIsDesktop } from "./Assistant";
import { AncestryPanel } from "./CatalogPanel";
import { type QuestionActions, QuestionsPanel } from "./QuestionsPanel";
import { RuleEditor } from "./RuleEditor";
import { ChangesPanel, ComparisonPanel, ImpactPanel, ReceiptsPanel, WeekDetail } from "./RunPanels";
import { ScenarioComposer } from "./ScenarioComposer";
import { ScenarioNav } from "./ScenarioNav";
import { WorkspaceChart } from "./WorkspaceChart";
import type { CatalogEntry, QuestionReceipt, Read, WorkspaceRun } from "./api";
import { BranchContext, type BranchPreview } from "./branchPreview";
import { eventFromItem, eventOptions } from "./drafts";
import { fieldOriginHref } from "./fieldOrigin";
import type { Outcome } from "./requests";
import {
  type ScenarioComparisons,
  assignColors,
  branchStart,
  colorFor,
  comparisonIds,
  familyEntries,
  firstDifference,
  forkOf,
  readComparison,
} from "./scenarioComparisons";
import { floorReceipt, runHeadline } from "./summary";

export type WorkspaceActions = QuestionActions & {
  reviseRules: (constraints: Constraint[], note: string) => Promise<Outcome>;
  simulate: (label: string, changes: Change[]) => Promise<Outcome>;
  catalogHref: string;
  /** Make another saved run the one new what-ifs build on, without leaving the page. */
  buildOn?: (runId: string) => void;
};

export type WorkspaceViewProps = {
  run: WorkspaceRun;
  parent: Read<WorkspaceRun> | null;
  graph: Read<CatalogEntry[]>;
  questions: Read<QuestionReceipt[]>;
  resultRef: Read<WeeklyResultRefV1>;
  actions: WorkspaceActions;
  /** Why writes are unavailable here (for example a fixture or no service connection). */
  disabled?: string;
  comparisons?: ScenarioComparisons;
  initialContext?: { selectedWeek?: string; selectedItemId?: string };
  chat?: (context: { selectedWeek?: string; selectedItemId?: string }) => ReactNode;
  /** Opens the assistant on this tab (a chat link opens the chat, on phones too). */
  initialAssistant?: AssistantTab;
  /** Saved risk scenarios for these books; defaults to this run's analysis page. */
  risksHref?: string;
  /** A short page-level notice under the header, e.g. newer books exist. */
  notice?: ReactNode;
  forecastNotice?: string;
  /** The workspace root: its forecast is the base line every scenario forks from. */
  baseRunId?: string | null;
};

const KIND = { baseline: "Imported books", rules: "Rules changed", scenario: "What-if" };
const SUMMARY =
  "flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-[15px] font-semibold tracking-[-0.01em] [&::-webkit-details-marker]:hidden";
const CHEVRON = "size-4 text-muted-foreground transition-transform group-open:rotate-90";

/** Saved min-cash breaches of one run, as chart notes. Text comes from its own receipts. */
function breachesOf(r: WorkspaceRun) {
  return r.receipts.flatMap((receipt) =>
    receipt.status === "breached" && receipt.kind === "min_cash" && receipt.weekStart
      ? [
          receipt.shortfall !== null &&
          receipt.unit === "cents" &&
          Number.isSafeInteger(receipt.shortfall)
            ? {
                weekStart: receipt.weekStart,
                text: `Below ${receipt.label} · short ${formatExactCents(receipt.shortfall)}`,
                short: `Short ${formatExactCents(receipt.shortfall)}`,
              }
            : { weekStart: receipt.weekStart, text: `Below ${receipt.label}` },
        ]
      : [],
  );
}

/** One saved scenario, interactive. Props only; every number comes from the saved record. */
export function WorkspaceView({
  run,
  parent,
  graph,
  questions,
  resultRef,
  actions,
  disabled,
  comparisons,
  chat,
  initialContext,
  initialAssistant,
  risksHref,
  notice,
  forecastNotice,
  baseRunId: baseRunIdProp,
}: WorkspaceViewProps) {
  const b = run.baseline;
  const originHref = fieldOriginHref(b.assumptionNote);
  const low = run.forecast.lowPoint;
  const [assistantTab, setAssistantTab] = useState<AssistantTab>(
    // One chat answers questions and drafts what-ifs; one-off questions are history behind it.
    chat ? "chat" : "ask",
  );
  const desktop = useIsDesktop();
  const [assistantExpanded, setAssistantOpen] = useState(initialAssistant === "chat");
  const assistantOpen = assistantExpanded;
  const [scenariosExpanded, setScenariosExpanded] = useState<boolean | null>(null);
  const scenariosOpen = scenariosExpanded ?? desktop;
  const [scenariosWide, setScenariosWide] = useState(false);
  const [focusKey, setFocusKey] = useState(0);
  const [composerOpen, setComposerOpen] = useState(false);
  const [bottomPanel, setBottomPanel] = useState<string | null>(null);
  const trayId = useId();
  const [selectedWeek, setSelectedWeek] = useState<string | null>(
    initialContext?.selectedWeek ?? low.weekStart,
  );
  const [selectedItemId, setSelectedItemId] = useState<string | null>(
    initialContext?.selectedItemId ?? null,
  );
  const options = useMemo(() => eventOptions(b.seed), [b.seed]);
  const suggestion = useMemo(() => {
    const item = b.seed.scheduledItems.find((i) => i.id === selectedItemId);
    return item ? eventFromItem(item, options) : undefined;
  }, [b.seed, selectedItemId, options]);
  const [localColors, setLocalColors] = useState<Record<string, number>>(
    run.kind === "baseline" ? {} : { [run.runId]: 0 },
  );
  const baseRunId =
    baseRunIdProp ??
    (run.kind === "baseline"
      ? run.runId
      : graph.state === "ready"
        ? (graph.value.find((e) => e.kind === "baseline" && e.parentRunId === null)?.runId ?? null)
        : null);
  const selection: ScenarioComparisons = comparisons ?? {
    ids: Object.keys(localColors),
    reads: {
      [run.runId]: { state: "ready", value: run },
      ...(run.parentRunId && parent ? { [run.parentRunId]: parent } : {}),
    },
    onChange: (ids) => setLocalColors((prev) => assignColors(prev, ids)),
    colors: localColors,
  };
  const selectedIds = comparisonIds(selection.ids, baseRunId ?? "");
  const entries = familyEntries(run, graph);
  const shownSet = new Set(selectedIds);
  const base = run.baseline.forecast;
  const forecastOf = (id: string) => {
    if (id === baseRunId) return base;
    const saved = selection.reads[id];
    return saved?.state === "ready" ? saved.value.forecast : null;
  };
  const curves = selectedIds.flatMap((id) => {
    if (selection.waitingRunIds?.includes(id)) return [];
    const saved = selection.reads[id];
    const read = saved?.state === "ready" ? readComparison(saved.value, run, id) : saved;
    if (read?.state !== "ready") return [];
    const anchorId = forkOf(id, entries, shownSet, baseRunId ?? "");
    const anchor = forecastOf(anchorId) ?? base;
    const diverges = firstDifference(read.value.forecast, anchor);
    return [
      {
        runId: id,
        reveal: selection.revealRunIds?.includes(id),
        label: read.value.label || "Untitled scenario",
        href: actions.hrefFor(id),
        forecast: read.value.forecast,
        color: colorFor(selection, id),
        // Drawn from the last week it still matches its anchor, so the branch leaves that line.
        // A branch that differs from the first forecast week forks from the last recorded week (-1).
        fromIndex: diverges < 0 ? null : diverges - 1,
        startsOn: entries.find((e) => e.runId === id)?.startsOn ?? null,
        breaches: breachesOf(read.value),
      },
    ];
  });
  const buildsOnStart = branchStart(run.runId, entries);
  // Proposal cards in the chat and Ask a question show where they would branch, and the chart
  // flashes that point on the open run's line.
  const [branchPreview, setBranchPreview] = useState<BranchPreview | null>(null);
  const parentIsBase = run.runId === baseRunId;
  const branchParent = useMemo(
    () => ({
      runId: run.runId,
      label: parentIsBase ? "Base forecast" : run.label || KIND[run.kind],
      color: parentIsBase ? "hsl(var(--primary))" : colorFor(selection, run.runId),
    }),
    [run.runId, run.label, run.kind, parentIsBase, selection],
  );
  const snapshot = b.seed.snapshot;
  const branchContext = useMemo(
    () => ({
      parent: branchParent,
      startOf: (changes: Change[]) => scenarioStart(changes, snapshot),
      preview: branchPreview,
      setPreview: setBranchPreview,
    }),
    [branchParent, snapshot, branchPreview],
  );
  const limits = run.constraints.flatMap((c) =>
    c.kind === "min_cash" && Number.isSafeInteger(c.limit)
      ? [{ id: c.id, label: c.label, cents: c.limit }]
      : [],
  );
  const breaches = breachesOf(run);
  const forecastStart = run.forecast.weeks[0]?.weekStart ?? b.seed.snapshot.asOf;
  // New events may not start before the scenario they build on.
  const firstWeek = buildsOnStart && buildsOnStart > forecastStart ? buildsOnStart : forecastStart;
  const floor = floorReceipt(run);
  const chatNode = chat
    ? chat({
        ...(selectedWeek ? { selectedWeek } : {}),
        ...(selectedItemId ? { selectedItemId } : {}),
      })
    : null;

  function openAssistant(tab: AssistantTab) {
    setAssistantTab(tab);
    setAssistantOpen(true);
    if (!desktop) setScenariosExpanded(false);
    setFocusKey((k) => k + 1);
  }

  return (
    <BranchContext.Provider value={branchContext}>
      <article
        className="relative flex h-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden [overflow-wrap:anywhere]"
        data-testid="workspace"
        data-run-id={run.runId}
      >
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2 sm:px-4">
          <div className="flex min-w-0 w-full items-center gap-2 sm:w-auto sm:flex-1">
            <Button
              size="icon"
              variant="ghost"
              aria-label={scenariosOpen ? "Collapse scenarios" : "Expand scenarios"}
              aria-expanded={scenariosOpen}
              aria-controls="workspace-scenarios"
              onClick={() => setScenariosExpanded(!scenariosOpen)}
              data-testid="scenarios-toggle"
            >
              {scenariosOpen ? (
                <PanelLeftClose aria-hidden="true" />
              ) : (
                <PanelLeftOpen aria-hidden="true" />
              )}
            </Button>
            <div className="min-w-0">
              <p className="truncate text-xs text-muted-foreground">
                {b.companyName} · Books as of {formatFullDate(b.seed.snapshot.asOf)}
              </p>
              <h1
                className="text-base font-semibold tracking-tight sm:text-lg"
                data-testid="workspace-headline"
              >
                {runHeadline(run)}
              </h1>
            </div>
          </div>
          <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-1.5 sm:w-auto">
            <Button size="sm" variant="ghost" asChild>
              <Link
                href={timelineCalculationHref(run.companyId, run.runId)}
                data-testid="action-calculation"
              >
                See how
              </Link>
            </Button>
            {run.kind !== "scenario" || risksHref ? (
              <Button size="sm" variant="ghost" asChild>
                <Link
                  href={risksHref ?? analysisHref(run.companyId, run.runId)}
                  data-testid="action-risks"
                >
                  <ShieldAlert aria-hidden="true" />
                  <span className="max-sm:sr-only">Saved risks</span>
                </Link>
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={assistantOpen}
              aria-controls="workspace-assistant"
              onClick={() => {
                if (assistantOpen) setAssistantOpen(false);
                else openAssistant(chat ? "chat" : "ask");
              }}
              data-testid="action-ask"
            >
              {assistantOpen ? (
                <PanelRightClose aria-hidden="true" />
              ) : (
                <PanelRightOpen aria-hidden="true" />
              )}
              <span>Ask Domino</span>
            </Button>
          </div>
        </header>
        <div className="relative flex min-h-0 flex-1">
          {scenariosOpen && !desktop ? (
            <button
              type="button"
              aria-label="Close scenario sidebar"
              className="absolute inset-0 z-20 bg-background/60"
              onClick={() => setScenariosExpanded(false)}
            />
          ) : null}
          <aside
            id="workspace-scenarios"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setScenariosExpanded(false);
                document
                  .querySelector<HTMLButtonElement>('[data-testid="scenarios-toggle"]')
                  ?.focus();
              }
            }}
            hidden={!scenariosOpen}
            className={`${scenariosOpen ? "flex" : "hidden"} absolute inset-y-0 left-0 z-30 min-h-0 w-[min(22rem,calc(100%_-_2rem))] shrink-0 flex-col border-r bg-card p-3 lg:relative lg:inset-auto lg:z-auto ${scenariosWide ? "lg:w-[23rem]" : "lg:w-64"}`}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Scenarios</h2>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="hidden lg:inline-flex"
                  aria-pressed={scenariosWide}
                  onClick={() => setScenariosWide(!scenariosWide)}
                  data-testid="scenarios-width"
                >
                  {scenariosWide ? "Narrow" : "Widen"}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Collapse scenarios"
                  onClick={() => setScenariosExpanded(false)}
                >
                  <PanelLeftClose aria-hidden="true" />
                </Button>
              </div>
            </div>
            <ScenarioNav
              run={run}
              graph={graph}
              baseRunId={baseRunId}
              comparisons={{ ...selection, ids: selectedIds }}
              buildOn={actions.buildOn}
              hrefFor={actions.hrefFor}
              catalogHref={actions.catalogHref}
              wide={scenariosWide}
            />
          </aside>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {notice}
            {parent && parent.state !== "ready" ? (
              <p className="text-xs text-muted-foreground" data-testid="parent-unavailable">
                {parent.state === "loading"
                  ? "Reading the scenario it started from..."
                  : "The scenario it started from could not be shown, so it is not drawn."}
              </p>
            ) : null}
            {originHref ? (
              <p
                className="px-2 pt-2 text-sm text-muted-foreground sm:px-4"
                data-testid="field-origin-link"
              >
                Started from a saved Field suggestion.{" "}
                <Link
                  href={originHref}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  See suggestion
                </Link>
              </p>
            ) : null}
            {run.label.startsWith("With fix:") &&
            parent?.state === "ready" &&
            parent.value.label.startsWith("If:") ? (
              <section
                className="mx-2 mt-2 grid gap-3 rounded-lg border bg-card p-3 sm:mx-4 sm:grid-cols-2"
                aria-label="Saved scenario and fix comparison"
                data-testid="field-fix-comparison"
              >
                <div>
                  <p className="text-xs text-muted-foreground">Without this fix</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {formatExactCents(parent.value.forecast.lowPoint.usable)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Lowest cash, week of {formatFullDate(parent.value.forecast.lowPoint.weekStart)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">With this fix</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {formatExactCents(low.usable)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Lowest cash, week of {formatFullDate(low.weekStart)}
                  </p>
                </div>
              </section>
            ) : null}

            <section
              className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 px-2 pb-2 pt-3 sm:px-4"
              aria-label="Timeline"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-[15px] font-semibold tracking-[-0.01em]">
                  Usable cash by week
                </h2>
                <p className="text-xs text-muted-foreground">
                  Hover for details, click a line to focus it
                </p>
              </div>
              {forecastNotice ? (
                <output className="text-xs text-muted-foreground" aria-live="polite">
                  {forecastNotice}
                </output>
              ) : null}
              <WorkspaceChart
                fill
                history={b.history}
                forecast={base}
                forecastLabel="Base forecast (no what-ifs)"
                forecastRunId={baseRunId ?? undefined}
                initialFocusRunId={run.runId}
                comparisons={curves}
                onReveal={selection.onReveal}
                items={b.seed.scheduledItems}
                limits={limits}
                breachedWeeks={run.runId === baseRunId ? breaches.map((n) => n.weekStart) : []}
                breachNotes={run.runId === baseRunId ? breaches : []}
                branchPreview={
                  branchPreview
                    ? {
                        key: branchPreview.key,
                        date: branchPreview.date,
                        color: branchParent.color,
                        label: branchParent.label,
                        // Draw the parent's line too while it flashes, even when it is not ticked.
                        forecast:
                          parentIsBase || selectedIds.includes(run.runId)
                            ? undefined
                            : run.forecast,
                      }
                    : undefined
                }
                selectedWeek={selectedWeek}
                onSelectWeek={(w) => {
                  setSelectedWeek(w);
                  setSelectedItemId(null);
                }}
              />
            </section>

            <div
              className="flex max-h-[45%] shrink-0 flex-col overflow-hidden border-t bg-card px-3 sm:px-4"
              data-testid="workspace-bottom-tray"
            >
              <div className="flex shrink-0 gap-1 overflow-x-auto" aria-label="Timeline details">
                {(
                  [
                    ["low", "Lowest point"],
                    ["minimum", "Lender's minimum"],
                    ["week", "Chosen week"],
                    ["cash", "Cash flows"],
                    ["more", "More details"],
                  ] as const
                ).map(([id, label]) => (
                  <Button
                    key={id}
                    variant="ghost"
                    size="sm"
                    className="h-11 shrink-0 gap-1"
                    aria-expanded={bottomPanel === id}
                    aria-controls={`${trayId}-${id}`}
                    onClick={() => setBottomPanel(bottomPanel === id ? null : id)}
                    data-testid={`disclosure-${id}`}
                  >
                    <ChevronRight
                      aria-hidden="true"
                      className={`size-3.5 ${bottomPanel === id ? "rotate-90" : ""}`}
                    />
                    {label}
                  </Button>
                ))}
              </div>
              <div className="min-h-0 overflow-y-auto">
                <div id={`${trayId}-low`} hidden={bottomPanel !== "low"}>
                  <div className="pb-3">
                    <StatTile
                      label="Lowest point"
                      value={formatExactCents(low.usable)}
                      delta={`Week of ${formatFullDate(low.weekStart)}`}
                      data-testid="tile-low"
                    />
                  </div>
                </div>
                <div id={`${trayId}-minimum`} hidden={bottomPanel !== "minimum"}>
                  <div className="pb-3">
                    <StatTile
                      label={floor?.label ?? "Cash minimum"}
                      value={floor ? formatExactCents(floor.limit) : "None set"}
                      tone={
                        floor?.status === "breached"
                          ? "negative"
                          : floor?.status === "clear"
                            ? "positive"
                            : "neutral"
                      }
                      delta={
                        floor
                          ? floor.status === "breached"
                            ? `${floor.shortfall !== null && Number.isSafeInteger(floor.shortfall) ? `Short ${formatExactCents(floor.shortfall)}` : "Below it"}${floor.weekStart ? `, week of ${formatFullDate(floor.weekStart)}` : ""}`
                            : floor.status === "clear"
                              ? "Stays above in every week"
                              : "Could not be checked"
                          : "Add one under Change the cash rules"
                      }
                      data-testid="tile-minimum"
                    />
                  </div>
                </div>
                <div id={`${trayId}-week`} hidden={bottomPanel !== "week"}>
                  <div className="pb-3">
                    <WeekDetail
                      run={run}
                      weekStart={selectedWeek}
                      selectedItemId={selectedItemId}
                      onSelectItem={setSelectedItemId}
                    />
                  </div>
                </div>
                <div id={`${trayId}-cash`} hidden={bottomPanel !== "cash"}>
                  <div className="overflow-x-auto pb-3">
                    <CashFlows run={run} />
                  </div>
                </div>
                <div
                  id={`${trayId}-more`}
                  hidden={bottomPanel !== "more"}
                  data-testid="workspace-more-details"
                >
                  <div className="space-y-3 pb-3">
                    <div className="pb-3">
                      <ScenarioComposer
                        selectedWeek={selectedWeek}
                        firstWeek={firstWeek}
                        buildsOn={{
                          label:
                            run.runId === baseRunId
                              ? "the base forecast"
                              : run.label || KIND[run.kind],
                          startsOn: buildsOnStart,
                        }}
                        invoices={options.invoices}
                        bills={options.bills}
                        suggestion={suggestion}
                        onRun={actions.simulate}
                        disabled={disabled}
                        open={composerOpen}
                        onOpenChange={setComposerOpen}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {run.label || KIND[run.kind]} · {KIND[run.kind]}, saved{" "}
                      {formatSavedAt(run.savedAt)}. Saved results never change.
                    </p>
                    <details className="group min-w-0">
                      <summary className={SUMMARY}>
                        <ChevronRight aria-hidden="true" className={CHEVRON} />
                        What changed and how it was built
                      </summary>
                      <div className="mt-2 grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
                        <ChangesPanel run={run} />
                        <ComparisonPanel run={run} />
                        <ImpactPanel dominoes={run.dominoes} />
                        <AncestryPanel graph={graph} runId={run.runId} hrefFor={actions.hrefFor} />
                      </div>
                    </details>
                    <details className="group min-w-0">
                      <summary className={SUMMARY}>
                        <ChevronRight aria-hidden="true" className={CHEVRON} />
                        Change the cash rules
                      </summary>
                      <div className="mt-2">
                        <RuleEditor
                          constraints={run.constraints}
                          bills={options.bills}
                          onSave={actions.reviseRules}
                          disabled={disabled}
                        />
                      </div>
                    </details>
                    <ReceiptsPanel run={run} />
                    <Provenance run={run} resultRef={resultRef} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <Assistant
            tab={assistantTab}
            onTab={setAssistantTab}
            askCount={questions.state === "ready" ? questions.value.length : 0}
            open={assistantOpen}
            onOpenChange={setAssistantOpen}
            focusKey={focusKey}
            chat={chatNode}
            ask={<QuestionsPanel questions={questions} actions={actions} />}
          />
        </div>
      </article>
    </BranchContext.Provider>
  );
}

function CashFlows({ run }: { run: WorkspaceRun }) {
  return (
    <table className="w-full text-left text-xs tabular-nums">
      <caption className="sr-only">Saved cash flows by forecast week</caption>
      <thead>
        <tr>
          {["Week of", "Starting cash", "Money in", "Money out", "Ending cash"].map((label) => (
            <th
              key={label}
              className="whitespace-nowrap px-2 py-2 font-medium text-muted-foreground"
            >
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {run.forecast.weeks.map((week) => (
          <tr key={week.weekStart} className="border-t">
            <th scope="row" className="whitespace-nowrap px-2 py-2 font-normal">
              {formatFullDate(week.weekStart)}
            </th>
            {[week.opening, week.inflow, week.outflow, week.closing].map((value, index) => (
              <td
                key={["opening", "inflow", "outflow", "closing"][index]}
                className="whitespace-nowrap px-2 py-2"
              >
                {formatExactCents(value)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Provenance({ run, resultRef }: { run: WorkspaceRun; resultRef: Read<WeeklyResultRefV1> }) {
  return (
    <details
      className="min-w-0 rounded-lg border bg-card text-xs shadow-xs"
      data-testid="provenance"
    >
      <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-medium">
        Where this came from
      </summary>
      <dl className="grid gap-2 border-t p-4 sm:grid-cols-2">
        {(
          [
            ["Saved scenario", run.runId],
            ["Started from", run.parentRunId ?? "Nothing: this is the imported baseline"],
            ["Imported baseline", run.baselineRunId],
            ["Weekly seed", `${run.baseline.seed.id} (${run.baseline.seedHash})`],
            ["Inputs fingerprint", run.inputHash],
            ["Method", run.methodVersion],
            ["Rules version", run.constraintVersion],
            ["Rules note", run.constraintNote || "None"],
            ["Operation", `${run.operation.title} (${run.operation.status})`],
          ] as const
        ).map(([k, v]) => (
          <div key={k}>
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="break-all font-mono">{v}</dd>
          </div>
        ))}
        <div>
          <dt className="text-muted-foreground">Result pointer</dt>
          <dd className="break-all font-mono" data-testid="result-ref">
            {resultRef.state === "ready"
              ? `${resultRef.value.kind} ${resultRef.value.route}`
              : resultRef.state === "loading"
                ? "Reading..."
                : resultRef.state === "missing"
                  ? "None saved"
                  : "Could not be shown"}
          </dd>
        </div>
      </dl>
    </details>
  );
}
