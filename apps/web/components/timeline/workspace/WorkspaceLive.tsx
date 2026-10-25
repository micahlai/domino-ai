"use client";

import type { Change, Constraint } from "@domino/contracts";
import { useMutation, useQueries } from "convex/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { hasEntryReveal, withoutEntryReveal } from "../../../lib/timeline-entry";
import { OPEN_IN_TIMELINE_NOTE, OpenInTimeline } from "../../field/OpenInTimeline";
import { operatingSelectionFromWorldId } from "../../field/company";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { PageHeader } from "../../ui/page";
import { Skeleton } from "../../ui/skeleton";
import { analysisHref } from "../analysis/links";
import { baselineHref } from "../baseline/api";
import { ChatSidebarLive } from "../chat/ChatLive";
import { CatalogList, ReadNotice } from "./CatalogPanel";
import { PredictionControl } from "./PredictionControl";
import { type WorkspaceActions, WorkspaceView } from "./WorkspaceView";
import {
  LinkResultSchema,
  type QuestionReceipt,
  type Read,
  RunResultSchema,
  allScenariosHref,
  catalogRef,
  getRunRef,
  graphRef,
  linkQuestionRef,
  listQuestionsRef,
  openRef,
  readCatalogPage,
  readGraph,
  readQuestions,
  readResultRef,
  readRun,
  resultRefRef,
  reviseConstraintsRef,
  simulateRef,
  workspaceHref,
  workspaceLinkFromSearch,
} from "./api";
import { NewerBooksNotice, fieldCompanyOf, useLatestImport } from "./books";
import {
  ForecastSaveGuard,
  type SavedForecasts,
  acceptedSelection,
  consumeForecast,
  forecastReadyToReveal,
  openedForecastReady,
  queueForecast,
} from "./forecastReveal";
import { confirmQuestionProposal } from "./proposals";
import { type Outcome, RequestLedger, UNUSABLE_ANSWER, describeWriteError } from "./requests";
import {
  assignColors,
  comparisonIds,
  familyEntries,
  readComparison,
  showWithAncestors,
} from "./scenarioComparisons";
import { ShownScenariosProvider, useShownScenarios } from "./shownScenarios";

export const CATALOG_PAGE_SIZE = 20;

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div role="alert" className="rounded-lg border p-5 text-sm">
      <p className="font-medium">{title}</p>
      <div className="mt-1 text-muted-foreground">{children}</div>
    </div>
  );
}

function useLedger() {
  return useState(() => new RequestLedger())[0];
}

/** Saved scenarios, one bounded page at a time. Each page is its own read; nothing recalculates. */
function CatalogLive({ companyId, hideEmpty }: { companyId: string; hideEmpty?: boolean }) {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const queries = useMemo(
    () =>
      Object.fromEntries(
        cursors.map((cursor, i) => [
          `p${i}`,
          {
            query: catalogRef,
            args: { companyId, paginationOpts: { numItems: CATALOG_PAGE_SIZE, cursor } },
          },
        ]),
      ),
    [companyId, cursors],
  );
  const raw = useQueries(queries) as Record<string, unknown>;
  const pages = cursors.map((_, i) => readCatalogPage(raw[`p${i}`], companyId));
  if (hideEmpty && !pages.some((p) => p.state === "ready" && p.value.entries.length)) return null;
  return (
    <CatalogList
      pages={pages}
      onMore={(cursor) => setCursors((cs) => (cs.includes(cursor) ? cs : [...cs, cursor]))}
      hrefFor={(runId) => workspaceHref(companyId, { runId })}
    />
  );
}

function Bootstrap({ companyId, baselineRunId }: { companyId: string; baselineRunId: string }) {
  const router = useRouter();
  const open = useMutation(openRef);
  const ledger = useLedger();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function start() {
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      const requestId = ledger.idFor(baselineRunId);
      const parsed = RunResultSchema.safeParse(await open({ companyId, baselineRunId, requestId }));
      if (!parsed.success || parsed.data.companyId !== companyId) setError(UNUSABLE_ANSWER);
      else router.replace(workspaceHref(companyId, { runId: parsed.data.runId }));
    } catch (e) {
      setError(describeWriteError(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border p-5" data-testid="workspace-bootstrap">
      <p className="font-medium">Start a workspace from this saved forecast</p>
      <p className="text-sm text-muted-foreground">
        The saved baseline stays as it is. Every rule or event you add becomes a new saved scenario
        that you can reopen and compare.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button onClick={start} disabled={pending} data-testid="workspace-open">
          {pending ? "Opening..." : "Open the workspace"}
        </Button>
        <Link
          href={baselineHref({ companyId, runId: baselineRunId })}
          className="self-center text-sm text-primary underline-offset-4 hover:underline"
        >
          View the saved baseline
        </Link>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function RunLive({ companyId, runId }: { companyId: string; runId: string }) {
  const key = useMemo(() => ({ companyId, runId }), [companyId, runId]);
  const queries = useMemo(() => ({ run: { query: getRunRef, args: key } }), [key]);
  const read = readRun((useQueries(queries) as Record<string, unknown>).run, key);
  // Switching the run new what-ifs build on keeps the page on screen until the next one loads.
  const last = useRef<{ key: typeof key; read: Extract<typeof read, { state: "ready" }> } | null>(
    null,
  );
  if (read.state === "ready") last.current = { key, read };
  if (read.state === "ready") return <RunReady key={runId} runKey={key} read={read} />;
  if (read.state === "loading" && last.current?.key.companyId === companyId)
    return (
      <div aria-busy="true" className="transition-opacity duration-150 opacity-70">
        <RunReady key={last.current.key.runId} runKey={last.current.key} read={last.current.read} />
      </div>
    );
  if (read.state === "loading")
    return (
      <div className="space-y-3" aria-busy="true">
        <output className="block text-sm text-muted-foreground">
          Opening the saved scenario...
        </output>
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  return (
    <div className="space-y-4">
      <ReadNotice read={read} what="saved scenario" />
      <Link
        href={allScenariosHref(companyId)}
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        All saved scenarios
      </Link>
    </div>
  );
}

function RunReady({
  runKey,
  read,
}: {
  runKey: { companyId: string; runId: string };
  read: Extract<ReturnType<typeof readRun>, { state: "ready" }>;
}) {
  const run = read.value;
  const params = useSearchParams();
  const { companyId } = runKey;
  const router = useRouter();
  const queries = useMemo(
    () => ({
      graph: { query: graphRef, args: { companyId, baselineRunId: run.baselineRunId } },
      questions: { query: listQuestionsRef, args: runKey },
      resultRef: { query: resultRefRef, args: runKey },
    }),
    [companyId, run.baselineRunId, runKey],
  );
  const raw = useQueries(queries) as Record<string, unknown>;
  const graph = readGraph(raw.graph, { companyId, baselineRunId: run.baselineRunId });
  const shown = useShownScenarios();
  const entryKey = JSON.stringify([companyId, run.runId]);
  const [entryRequested] = useState(
    () =>
      run.parentRunId !== null &&
      run.kind !== "baseline" &&
      hasEntryReveal(params.toString(), run.runId) &&
      !shown.revealedEntries.has(entryKey),
  );
  const [entryConsumed, setEntryConsumed] = useState(false);
  const entryWaiting = entryRequested && !entryConsumed;
  useEffect(() => {
    if (!entryWaiting && hasEntryReveal(window.location.search, run.runId))
      window.history.replaceState(
        window.history.state,
        "",
        withoutEntryReveal(window.location.href, run.runId),
      );
  }, [entryWaiting, run.runId]);
  const [saveGuard] = useState(() => new ForecastSaveGuard());
  saveGuard.setContext({ companyId, runId: params.get("runId") ?? run.runId });
  useEffect(() => {
    saveGuard.activate();
    return () => saveGuard.dispose();
  }, [saveGuard]);
  const [savedForecasts, setSavedForecasts] = useState<SavedForecasts>({});
  const [omittedAncestors, setOmittedAncestors] = useState(0);
  const baseRunId =
    run.kind === "baseline"
      ? run.runId
      : graph.state === "ready"
        ? (graph.value.find((e) => e.kind === "baseline" && e.parentRunId === null)?.runId ?? null)
        : null;
  // Opening a saved what-if shows it; the bare timeline shows only the base forecast. Its
  // parents are added once the family graph loads, so a deep link lands with its full branch.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per opened run and graph read
  useEffect(() => {
    if (run.kind !== "baseline" && !entryWaiting) show(run.runId);
  }, [run.runId, graph.state]);
  // A scenario is drawn with every scenario it builds on, so its branch leaves a visible line.
  const show = (id: string) => {
    const next = showWithAncestors(shown.ids, id, familyEntries(run, graph), baseRunId ?? "");
    if (next && next.length !== shown.ids.length) shown.set(next);
  };
  const entrySelection =
    entryWaiting && graph.state === "ready" && run.parentRunId
      ? acceptedSelection(
          shown.ids,
          run.runId,
          run.parentRunId,
          familyEntries(run, graph),
          baseRunId ?? "",
        )
      : null;
  const selectedComparisons = comparisonIds(entrySelection?.ids ?? shown.ids, baseRunId ?? "");
  // Keep the priority selection after the entry signal is consumed; the mounted chart stays put.
  const entrySelectionKey = entrySelection?.ids.join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: snapshot keyed by bounded run IDs
  useEffect(() => {
    if (entrySelection) {
      shown.set(entrySelection.ids);
      setOmittedAncestors(entrySelection.omittedAncestors);
    }
  }, [entrySelectionKey]);
  const comparisonKey = selectedComparisons.join("\n");
  // Convex stores subscription callbacks by query-bag identity and updates state during render
  // when they change. Memoize on the bounded ID list, not the freshly parsed graph array.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by the joined id list
  const comparisonQueries = useMemo(
    () => ({
      ...Object.fromEntries(
        selectedComparisons
          .filter((id) => id !== run.runId)
          .map((id) => [`comparison:${id}`, { query: getRunRef, args: { companyId, runId: id } }]),
      ),
      ...(entryWaiting && run.parentRunId
        ? { entryParent: { query: getRunRef, args: { companyId, runId: run.parentRunId } } }
        : {}),
    }),
    [companyId, comparisonKey, run.runId, run.parentRunId, entryWaiting],
  );
  const comparisonRaw = useQueries(comparisonQueries) as Record<string, unknown>;
  const comparisonReads: Record<string, Read<import("./api").WorkspaceRun>> = {};
  for (const id of selectedComparisons) {
    comparisonReads[id] =
      id === run.runId
        ? { state: "ready", value: run }
        : readComparison(comparisonRaw[`comparison:${id}`], run, id);
    const checked = comparisonReads[id];
    if (savedForecasts[id] && checked?.state === "ready" && checked.value.parentRunId !== run.runId)
      comparisonReads[id] = { state: "unusable" };
  }
  const entryReads = { ...comparisonReads };
  if (entryWaiting && run.parentRunId)
    entryReads[run.parentRunId] = readComparison(comparisonRaw.entryParent, run, run.parentRunId);
  const entryReady =
    entryWaiting && openedForecastReady(run, graph, entryReads, selectedComparisons, baseRunId);
  const parent = run.parentRunId ? (entryReads[run.parentRunId] ?? null) : null;
  function consumeEntry() {
    shown.revealedEntries.add(entryKey);
    setEntryConsumed(true);
    if (hasEntryReveal(window.location.search, run.runId))
      window.history.replaceState(
        window.history.state,
        "",
        withoutEntryReveal(window.location.href, run.runId),
      );
  }

  const simulate = useMutation(simulateRef);
  const revise = useMutation(reviseConstraintsRef);
  const link = useMutation(linkQuestionRef);
  const runs = useLedger();

  function showSavedForecast(resultRunId: string) {
    if (!saveGuard.matches(runKey)) return;
    const entries = familyEntries(run, graph);
    setSavedForecasts((current) => queueForecast(current, resultRunId));
    setOmittedAncestors(
      acceptedSelection([], resultRunId, run.runId, entries, baseRunId ?? "").omittedAncestors,
    );
    shown.set(
      (ids) => acceptedSelection(ids, resultRunId, run.runId, entries, baseRunId ?? "").ids,
    );
  }

  async function write(call: () => Promise<unknown>): Promise<Outcome> {
    const context = saveGuard.capture();
    try {
      const parsed = RunResultSchema.safeParse(await call());
      if (!parsed.success || parsed.data.companyId !== companyId)
        return { ok: false, message: UNUSABLE_ANSWER };
      if (saveGuard.allows(context)) showSavedForecast(parsed.data.runId);
      return { ok: true, runId: parsed.data.runId };
    } catch (e) {
      return { ok: false, message: describeWriteError(e) };
    }
  }

  function runScenario(
    label: string,
    changes: Change[],
    constraints: Constraint[] | null,
    constraintNote: string | null,
  ) {
    const changesJson = JSON.stringify(changes);
    const constraintsJson = constraints ? JSON.stringify(constraints) : undefined;
    const payload = JSON.stringify([
      "simulate",
      run.runId,
      label,
      changesJson,
      constraintsJson ?? null,
      constraintNote,
    ]);
    const requestId = runs.idFor(payload);
    return write(() =>
      simulate({
        companyId,
        parentRunId: run.runId,
        requestId,
        label,
        changesJson,
        reviewed: true,
        ...(constraintsJson !== undefined ? { constraintsJson } : {}),
        ...(constraintNote !== null ? { constraintNote } : {}),
      }),
    );
  }

  async function relink(questionId: string, resultRunId: string): Promise<Outcome> {
    try {
      const parsed = LinkResultSchema.safeParse(await link({ companyId, questionId, resultRunId }));
      if (!parsed.success || parsed.data.linkedRunId !== resultRunId)
        return { ok: false, message: UNUSABLE_ANSWER };
      return { ok: true, runId: resultRunId };
    } catch (e) {
      return { ok: false, message: describeWriteError(e) };
    }
  }

  const latest = useLatestImport(companyId);
  const actions: WorkspaceActions = {
    catalogHref: allScenariosHref(companyId),
    hrefFor: (id) => workspaceHref(companyId, { runId: id }),
    // A new what-if is drawn in its own color; the page stays on the run it was built on.
    simulate: (label, changes) => runScenario(label, changes, null, null),
    buildOn: (id) => router.replace(workspaceHref(companyId, { runId: id }), { scroll: false }),
    reviseRules: (constraints, note) => {
      const constraintsJson = JSON.stringify(constraints);
      const requestId = runs.idFor(JSON.stringify(["rules", run.runId, constraintsJson, note]));
      return write(() =>
        revise({
          companyId,
          parentRunId: run.runId,
          requestId,
          constraintsJson,
          note,
          reviewed: true,
        }),
      );
    },
    confirmProposal: (q: QuestionReceipt) =>
      confirmQuestionProposal(q, runKey, runs, {
        revise: (args) => write(() => revise(args)),
        simulate: (args) => write(() => simulate(args)),
        relink,
      }),
    relink,
  };

  const waitingReads = Object.entries(savedForecasts).filter(
    ([id, status]) =>
      status === "waiting" &&
      selectedComparisons.includes(id) &&
      comparisonReads[id]?.state !== "ready",
  );
  const waitingNotice = waitingReads.length
    ? waitingReads.some(([id]) => comparisonReads[id]?.state !== "loading")
      ? "The scenario is saved, but its forecast could not be displayed. Reopen it from Saved scenarios."
      : "Reading the new saved forecast..."
    : undefined;
  const visibleGraph =
    graph.state === "ready"
      ? {
          ...graph,
          value: selectedComparisons.reduce((entries, id) => {
            const read = entryReads[id];
            return read?.state === "ready"
              ? familyEntries(read.value, { state: "ready", value: entries })
              : entries;
          }, graph.value),
        }
      : graph;

  return (
    <WorkspaceView
      run={run}
      parent={parent}
      graph={visibleGraph}
      comparisons={{
        ids: selectedComparisons,
        reads: entryReads,
        waitingRunIds: entryWaiting && !entryReady ? [run.runId] : [],
        onChange: (ids) => {
          setOmittedAncestors(0);
          shown.set(ids);
        },
        colors: entrySelection ? assignColors(shown.colors, selectedComparisons) : shown.colors,
        revealRunIds: [
          ...(entryReady ? [run.runId] : []),
          ...Object.entries(savedForecasts).flatMap(([runId, status]) =>
            status === "waiting" &&
            forecastReadyToReveal({ runId, parentRunId: run.runId }, run, comparisonReads[runId])
              ? [runId]
              : [],
          ),
        ],
        onReveal: (runId) => {
          if (entryReady && runId === run.runId) consumeEntry();
          else setSavedForecasts((current) => consumeForecast(current, runId));
        },
      }}
      baseRunId={baseRunId}
      scenarioRowExtra={({ runId, name, show }) => (
        <PredictionControl companyId={companyId} runId={runId} name={name} show={show} />
      )}
      forecastNotice={
        omittedAncestors > 0 || (entrySelection?.omittedAncestors ?? 0) > 0
          ? "Showing the new forecast and its 5 nearest parent scenarios. Earlier parents stay saved; the chart shows up to 6 scenario lines."
          : entryWaiting && !entryReady
            ? ["unusable", "error", "missing"].includes(graph.state) ||
              Object.values(entryReads).some((read) =>
                ["unusable", "error", "missing"].includes(read.state),
              )
              ? "The scenario is saved, but its parent forecast could not be verified. Reopen it from Saved scenarios."
              : "Reading the saved scenario and the forecast it branches from..."
            : waitingNotice
      }
      questions={readQuestions(raw.questions, runKey) as Read<QuestionReceipt[]>}
      resultRef={readResultRef(raw.resultRef)}
      actions={actions}
      initialContext={{
        selectedWeek: params.get("selectedWeek") ?? undefined,
        selectedItemId: params.get("selectedItemId") ?? undefined,
      }}
      chat={(context) => (
        <ChatSidebarLive run={run} {...context} onSavedForecast={showSavedForecast} />
      )}
      initialAssistant={params.get("conversationId") ? "chat" : undefined}
      risksHref={
        latest.state === "ready" && latest.runId === run.runId && latest.analysisId
          ? analysisHref(companyId, run.runId, latest.analysisId)
          : undefined
      }
      notice={<NewerBooksNotice companyId={companyId} />}
    />
  );
}

/** Company name and the simulated-data label, shared by every Timeline page state. */
function CompanyEyebrow({ companyId }: { companyId: string }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="font-medium text-foreground">
        {fieldCompanyOf(companyId)?.name ?? companyId}
      </span>
      {operatingSelectionFromWorldId(companyId)?.company === "2u" ? (
        <Badge variant="secondary">Public filings</Badge>
      ) : operatingSelectionFromWorldId(companyId) ? (
        <Badge variant="secondary">Simulated</Badge>
      ) : null}
    </span>
  );
}

/** Timeline fills the window, so pages that are not the chart add the app's usual gutter. */
const PAGE_GUTTER = "px-4 py-6 md:px-8 md:py-8";

function CatalogPage({ companyId }: { companyId: string }) {
  const latest = useLatestImport(companyId);
  return (
    <div className={`space-y-6 ${PAGE_GUTTER}`}>
      <PageHeader
        eyebrow={<CompanyEyebrow companyId={companyId} />}
        title="Saved scenarios"
        description="Every saved forecast and what-if for this company, newest first. Opening one only reads it; saved results never change."
        actions={
          latest.state === "ready" ? (
            <Button variant="outline" asChild>
              <Link href={latest.route}>Open the latest timeline</Link>
            </Button>
          ) : null
        }
      />
      <CatalogLive companyId={companyId} />
    </div>
  );
}

/**
 * The bare timeline address: open the selected company's latest imported books, or explain how
 * to bring them in. Importing is never started from a page load.
 */
function CompanyHome({ companyId }: { companyId: string }) {
  const latest = useLatestImport(companyId);
  const router = useRouter();
  // With no current import but saved forecasts, open the newest saved one, never an empty state.
  const newestQuery = useMemo(
    () => ({
      c: { query: catalogRef, args: { companyId, paginationOpts: { numItems: 1, cursor: null } } },
    }),
    [companyId],
  );
  const saved = readCatalogPage((useQueries(newestQuery) as Record<string, unknown>).c, companyId);
  const newest = saved.state === "ready" ? saved.value.entries[0] : undefined;
  const route =
    latest.state === "ready"
      ? latest.route
      : latest.state === "none" && !latest.replay && newest
        ? workspaceHref(companyId, { runId: newest.runId })
        : null;
  useEffect(() => {
    if (route) router.replace(route);
  }, [route, router]);
  if (latest.state === "not_field") return <CatalogPage companyId={companyId} />;
  if (latest.state !== "none" || route || (saved.state === "loading" && !latest.replay))
    return (
      <div className={`space-y-3 ${PAGE_GUTTER}`} aria-busy="true">
        <output className="block text-sm text-muted-foreground">
          Opening the latest timeline...
        </output>
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  const name = fieldCompanyOf(companyId)?.name ?? companyId;
  return (
    <div className={`space-y-6 ${PAGE_GUTTER}`} data-testid="timeline-empty">
      <PageHeader
        eyebrow={<CompanyEyebrow companyId={companyId} />}
        title={`No timeline for ${name} yet`}
        description={
          operatingSelectionFromWorldId(companyId)
            ? "Bring in the books to see a simulated 13-week cash forecast."
            : "Bring in the latest books to see a 13-week cash forecast."
        }
      />
      <section className="max-w-2xl space-y-4 rounded-lg border bg-card p-5 shadow-xs">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Usable cash for the next 13 weeks, next to recent history</li>
          <li>The lowest point against the lender's minimum</li>
          <li>Ask questions and model events</li>
        </ul>
        <OpenInTimeline label="Bring in latest books" />
        <p className="text-xs text-muted-foreground">{OPEN_IN_TIMELINE_NOTE}</p>
      </section>
      {latest.replay ? null : <CatalogLive companyId={companyId} hideEmpty />}
    </div>
  );
}

function Connected({ companyId, landing }: { companyId: string; landing: "latest" | "catalog" }) {
  const search = useSearchParams();
  const link = workspaceLinkFromSearch(search.toString());
  if (link.kind === "conflict")
    return (
      <Notice title="This link names two starting points">
        A workspace link opens either a saved scenario or a saved baseline, not both.{" "}
        <Link
          href={allScenariosHref(companyId)}
          className="text-primary underline-offset-4 hover:underline"
        >
          See all saved scenarios
        </Link>
      </Notice>
    );
  if (link.kind === "run") return <RunLive companyId={companyId} runId={link.runId} />;
  if (link.kind === "bootstrap")
    return <Bootstrap companyId={companyId} baselineRunId={link.baselineRunId} />;
  if (landing === "catalog") return <CatalogLive companyId={companyId} />;
  if (search.get("view") === "all") return <CatalogPage companyId={companyId} />;
  return <CompanyHome companyId={companyId} />;
}

/** Timeline workspace route body. A missing service connection stays visible, never faked. */
export function WorkspaceLive({
  companyId,
  landing = "catalog",
}: {
  companyId: string;
  /** "latest": the bare address opens the latest imported books (the Timeline page). */
  landing?: "latest" | "catalog";
}) {
  return (
    <Suspense
      fallback={
        <div className="space-y-3" aria-busy="true">
          <output className="block text-sm text-muted-foreground">
            Reading the page address...
          </output>
          <Skeleton className="h-40 w-full" />
        </div>
      }
    >
      {process.env.NEXT_PUBLIC_CONVEX_URL ? (
        <ShownScenariosProvider>
          <Connected companyId={companyId} landing={landing} />
        </ShownScenariosProvider>
      ) : (
        <Notice title="Cannot open saved scenarios here">
          This page is not connected to the forecast service, so saved scenarios cannot be opened or
          created.
        </Notice>
      )}
    </Suspense>
  );
}
