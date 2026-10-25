"use client";

import type { Change, Constraint, WeeklyResultRefV1 } from "@domino/contracts";
import { ChevronRight, MessageCircle, ShieldAlert, SquarePlus } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";
import { scenarioStart } from "../../../convex/timeline/scenarioStart";
import { timelineCalculationHref } from "../../../lib/trace-links";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { PageHeader, StatTile } from "../../ui/page";
import { analysisHref } from "../analysis/links";
import { formatExactCents, formatFullDate, formatSavedAt } from "../baseline/format";
import { Assistant, type AssistantTab, smoothScroll } from "./Assistant";
import { AncestryPanel } from "./CatalogPanel";
import { type QuestionActions, QuestionsPanel } from "./QuestionsPanel";
import { RuleEditor } from "./RuleEditor";
import {
  ChangesPanel,
  ComparisonPanel,
  ImpactPanel,
  ReceiptsPanel,
  WeekDetail,
  WhenDate,
  formatDelta,
} from "./RunPanels";
import { ScenarioComposer } from "./ScenarioComposer";
import { ScenarioNav } from "./ScenarioNav";
import { ScenarioSidebar } from "./ScenarioSidebar";
import { familyEntries } from "./ScenarioSidebar";
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
  baseRunId: baseRunIdProp,
}: WorkspaceViewProps) {
  const b = run.baseline;
  const originHref = fieldOriginHref(b.assumptionNote);
  const low = run.forecast.lowPoint;
  const [assistantTab, setAssistantTab] = useState<AssistantTab>(
    // One chat answers questions and drafts what-ifs; one-off questions are history behind it.
    chat ? "chat" : "ask",
  );
  const [assistantOpen, setAssistantOpen] = useState(initialAssistant === "chat");
  const [focusKey, setFocusKey] = useState(0);
  const [composerOpen, setComposerOpen] = useState(false);
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
    const saved = selection.reads[id];
    const read = saved?.state === "ready" ? readComparison(saved.value, run, id) : saved;
    if (read?.state !== "ready") return [];
    const anchorId = forkOf(id, entries, shownSet, baseRunId ?? "");
    const anchor = forecastOf(anchorId) ?? base;
    const diverges = firstDifference(read.value.forecast, anchor);
    return [
      {
        runId: id,
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
  const lastWeek = run.forecast.weeks.at(-1)?.weekStart ?? firstWeek;
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
    setFocusKey((k) => k + 1);
  }
  function tryEvent() {
    setComposerOpen(true);
    requestAnimationFrame(() => {
      const el = document.getElementById("try-an-event");
      el?.scrollIntoView({ block: "start", behavior: smoothScroll() });
      el?.querySelector<HTMLElement>('[data-testid="event-kind"]')?.focus({
        preventScroll: true,
      });
    });
  }

  return (
    <BranchContext.Provider value={branchContext}>
      <article
        className="grid min-w-0 max-w-full grid-cols-1 items-start gap-6 [overflow-wrap:anywhere] lg:grid-cols-[minmax(0,1fr)_23rem] xl:grid-cols-[16rem_minmax(0,1fr)_24rem] 2xl:grid-cols-[18rem_minmax(0,1fr)_26rem]"
        data-testid="workspace"
        data-run-id={run.runId}
      >
        <ScenarioNav
          run={run}
          graph={graph}
          baseRunId={baseRunId}
          comparisons={{ ...selection, ids: selectedIds }}
          buildOn={actions.buildOn}
          hrefFor={actions.hrefFor}
          catalogHref={actions.catalogHref}
        />
        <div className="min-w-0 max-w-full space-y-6">
          <PageHeader
            eyebrow={
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium text-foreground">{b.companyName}</span>
                <Badge variant="secondary">Simulated company</Badge>
                <span aria-hidden="true" className="max-sm:hidden">
                  ·
                </span>
                <span>{run.label || KIND[run.kind]}</span>
                <span aria-hidden="true" className="max-sm:hidden">
                  ·
                </span>
                <span>Books as of {formatFullDate(b.seed.snapshot.asOf)}</span>
              </span>
            }
            title={<span data-testid="workspace-headline">{runHeadline(run)}</span>}
            description={
              <>
                Lowest usable cash is {formatExactCents(low.usable)} in the week of{" "}
                <WhenDate iso={low.weekStart} />. {KIND[run.kind]}, saved{" "}
                {formatSavedAt(run.savedAt)}. Saved results never change.
              </>
            }
            actions={
              <>
                <Button
                  onClick={() => openAssistant(chat ? "chat" : "ask")}
                  data-testid="action-ask"
                >
                  <MessageCircle aria-hidden="true" />
                  Ask a question
                </Button>
                <Button variant="outline" onClick={tryEvent} data-testid="action-event">
                  <SquarePlus aria-hidden="true" />
                  Try an event
                </Button>
                <Button variant="outline" asChild>
                  <Link
                    href={timelineCalculationHref(run.companyId, run.runId)}
                    data-testid="action-calculation"
                  >
                    How we got here
                  </Link>
                </Button>
                {run.kind !== "scenario" || risksHref ? (
                  <Button variant="outline" asChild>
                    <Link
                      href={risksHref ?? analysisHref(run.companyId, run.runId)}
                      data-testid="action-risks"
                    >
                      <ShieldAlert aria-hidden="true" />
                      See saved risks
                    </Link>
                  </Button>
                ) : null}
              </>
            }
          />
          {notice}
          {originHref ? (
            <p className="text-sm text-muted-foreground" data-testid="field-origin-link">
              Started from a saved Field suggestion.{" "}
              <Link
                href={originHref}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Why that suggestion
              </Link>
            </p>
          ) : null}
          {parent && parent.state !== "ready" ? (
            <p className="text-xs text-muted-foreground" data-testid="parent-unavailable">
              {parent.state === "loading"
                ? "Reading the scenario it started from..."
                : "The scenario it started from could not be shown, so it is not drawn."}
            </p>
          ) : null}

          {run.label.startsWith("With fix:") &&
          parent?.state === "ready" &&
          parent.value.label.startsWith("If:") ? (
            <section
              className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2"
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

          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile
              label="Lowest point"
              value={formatExactCents(low.usable)}
              delta={`Week of ${formatFullDate(low.weekStart)}`}
              data-testid="tile-low"
            />
            {floor ? (
              <StatTile
                label={floor.label}
                value={formatExactCents(floor.limit)}
                tone={
                  floor.status === "breached"
                    ? "negative"
                    : floor.status === "clear"
                      ? "positive"
                      : "neutral"
                }
                delta={
                  floor.status === "breached"
                    ? `${floor.shortfall !== null && Number.isSafeInteger(floor.shortfall) ? `Short ${formatExactCents(floor.shortfall)}` : "Below it"}${floor.weekStart ? `, week of ${formatFullDate(floor.weekStart)}` : ""}`
                    : floor.status === "clear"
                      ? "Stays above in every week"
                      : "Could not be checked"
                }
                data-testid="tile-minimum"
              />
            ) : (
              <StatTile
                label="Cash minimum"
                value="None set"
                delta="Add one under Change the cash rules"
                data-testid="tile-minimum"
              />
            )}
            {run.comparison ? (
              <StatTile
                label="Lowest point vs. where it started"
                value={formatDelta(run.comparison.lowPointDelta)}
                delta={
                  run.ownChanges.length === 0
                    ? "Only the rules changed"
                    : `${run.ownChanges.length} ${run.ownChanges.length === 1 ? "change" : "changes"} in this scenario`
                }
              />
            ) : (
              <StatTile
                className="max-sm:hidden"
                label="Forecast"
                value={`${run.forecast.weeks.length} weeks`}
                delta={`${formatFullDate(firstWeek)} to ${formatFullDate(lastWeek)}`}
              />
            )}
          </div>

          <section className="min-w-0 space-y-4 rounded-lg border bg-card p-4 shadow-xs sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Usable cash by week</h2>
              <p className="text-xs text-muted-foreground">
                Hover a week for details, click one to pick it
              </p>
            </div>
            <WorkspaceChart
              history={b.history}
              forecast={base}
              forecastLabel="Base forecast (no what-ifs)"
              comparisons={curves}
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
                        parentIsBase || selectedIds.includes(run.runId) ? undefined : run.forecast,
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

          <ScenarioComposer
            selectedWeek={selectedWeek}
            firstWeek={firstWeek}
            buildsOn={{
              label: run.runId === baseRunId ? "the base forecast" : run.label || KIND[run.kind],
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

          <div className="grid min-w-0 grid-cols-1 items-start gap-4 md:grid-cols-2">
            <WeekDetail
              run={run}
              weekStart={selectedWeek}
              selectedItemId={selectedItemId}
              onSelectItem={setSelectedItemId}
            />
            <ReceiptsPanel run={run} />
          </div>

          <ScenarioSidebar
            run={run}
            graph={graph}
            baseRunId={baseRunId}
            comparisons={{ ...selection, ids: selectedIds }}
            hrefFor={actions.hrefFor}
            catalogHref={actions.catalogHref}
          />

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
          <Provenance run={run} resultRef={resultRef} />
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
      </article>
    </BranchContext.Provider>
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
