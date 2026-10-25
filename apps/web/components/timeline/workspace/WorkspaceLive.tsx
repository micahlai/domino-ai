"use client";

import type { Change, Constraint } from "@domino/contracts";
import { useAction, useMutation, useQueries } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, Suspense, useMemo, useState } from "react";
import { Button } from "../../ui/button";
import { Skeleton } from "../../ui/skeleton";
import { baselineHref } from "../baseline/api";
import { CatalogList, ReadNotice } from "./CatalogPanel";
import type { AskInput, AskOutcome } from "./QuestionsPanel";
import { type WorkspaceActions, WorkspaceView } from "./WorkspaceView";
import {
  LinkResultSchema,
  type QuestionReceipt,
  type Read,
  RunResultSchema,
  askRef,
  catalogRef,
  getRunRef,
  graphRef,
  linkQuestionRef,
  listQuestionsRef,
  openRef,
  readCatalogPage,
  readGraph,
  readQuestion,
  readQuestions,
  readResultRef,
  readRun,
  resultRefRef,
  reviseConstraintsRef,
  simulateRef,
  workspaceHref,
  workspaceLinkFromSearch,
} from "./api";
import { confirmQuestionProposal } from "./proposals";
import { type Outcome, RequestLedger, UNUSABLE_ANSWER, describeWriteError } from "./requests";
import { comparisonIds, readComparison } from "./scenarioComparisons";

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
function CatalogLive({ companyId }: { companyId: string }) {
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
        <p role="alert" className="text-sm text-[#E6A5B9]">
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
  if (read.state === "ready") return <RunReady key={runId} runKey={key} read={read} />;
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
        href={workspaceHref(companyId)}
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
  const [chosenComparisons, setChosenComparisons] = useState<string[] | null>(null);
  const defaults = run.parentRunId
    ? [run.parentRunId]
    : graph.state === "ready"
      ? graph.value
          .filter((entry) => entry.parentRunId === run.runId)
          .slice(0, 1)
          .map((entry) => entry.runId)
      : [];
  const selectedComparisons = comparisonIds(chosenComparisons ?? defaults, run.runId);
  const comparisonQueries = Object.fromEntries(
    selectedComparisons.map((id, i) => [
      `comparison${i}`,
      { query: getRunRef, args: { companyId, runId: id } },
    ]),
  );
  const comparisonRaw = useQueries(comparisonQueries) as Record<string, unknown>;
  const comparisonReads: Record<string, Read<import("./api").WorkspaceRun>> = {};
  let comparisonIndex = 0;
  for (const id of selectedComparisons) {
    comparisonReads[id] = readComparison(comparisonRaw[`comparison${comparisonIndex++}`], run, id);
  }

  const parent = run.parentRunId ? (comparisonReads[run.parentRunId] ?? null) : null;

  const simulate = useMutation(simulateRef);
  const revise = useMutation(reviseConstraintsRef);
  const ask = useAction(askRef);
  const link = useMutation(linkQuestionRef);
  const runs = useLedger();
  const asks = useLedger();

  async function write(call: () => Promise<unknown>, navigate: boolean): Promise<Outcome> {
    try {
      const parsed = RunResultSchema.safeParse(await call());
      if (!parsed.success || parsed.data.companyId !== companyId)
        return { ok: false, message: UNUSABLE_ANSWER };
      if (navigate) router.push(workspaceHref(companyId, { runId: parsed.data.runId }));
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
    navigate: boolean,
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
    return write(
      () =>
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
      navigate,
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

  const actions: WorkspaceActions = {
    catalogHref: workspaceHref(companyId),
    hrefFor: (id) => workspaceHref(companyId, { runId: id }),
    simulate: (label, changes) => runScenario(label, changes, null, null, true),
    reviseRules: (constraints, note) => {
      const constraintsJson = JSON.stringify(constraints);
      const requestId = runs.idFor(JSON.stringify(["rules", run.runId, constraintsJson, note]));
      return write(
        () =>
          revise({
            companyId,
            parentRunId: run.runId,
            requestId,
            constraintsJson,
            note,
            reviewed: true,
          }),
        true,
      );
    },
    ask: async (input: AskInput, fresh: boolean): Promise<AskOutcome> => {
      const payload = JSON.stringify([
        run.runId,
        input.prompt,
        input.selectedWeek,
        input.selectedItemId,
      ]);
      const requestId = fresh ? asks.renew(payload) : asks.idFor(payload);
      try {
        const receipt = readQuestion(
          await ask({
            ...runKey,
            requestId,
            prompt: input.prompt,
            ...(input.selectedWeek ? { selectedWeek: input.selectedWeek } : {}),
            ...(input.selectedItemId ? { selectedItemId: input.selectedItemId } : {}),
          }),
          runKey,
        );
        return receipt
          ? { ok: true, receipt }
          : {
              ok: false,
              message: "The answer came back in an unexpected shape, so it is not shown.",
            };
      } catch (e) {
        if (e instanceof ConvexError) return { ok: false, message: describeWriteError(e) };
        return {
          ok: false,
          message:
            "Could not confirm the question was received. Ask again: it repeats the same request, so it is not asked twice.",
        };
      }
    },
    confirmProposal: (q: QuestionReceipt) =>
      confirmQuestionProposal(q, runKey, runs, {
        revise: (args) => write(() => revise(args), false),
        simulate: (args) => write(() => simulate(args), false),
        relink,
      }),
    relink,
  };

  return (
    <WorkspaceView
      run={run}
      parent={parent}
      graph={graph}
      comparisons={{
        ids: selectedComparisons,
        reads: comparisonReads,
        onChange: setChosenComparisons,
      }}
      questions={readQuestions(raw.questions, runKey) as Read<QuestionReceipt[]>}
      resultRef={readResultRef(raw.resultRef)}
      actions={actions}
    />
  );
}

function Connected({ companyId }: { companyId: string }) {
  const link = workspaceLinkFromSearch(useSearchParams().toString());
  if (link.kind === "conflict")
    return (
      <Notice title="This link names two starting points">
        A workspace link opens either a saved scenario or a saved baseline, not both.{" "}
        <Link
          href={workspaceHref(companyId)}
          className="text-primary underline-offset-4 hover:underline"
        >
          See all saved scenarios
        </Link>
      </Notice>
    );
  if (link.kind === "run") return <RunLive companyId={companyId} runId={link.runId} />;
  if (link.kind === "bootstrap")
    return <Bootstrap companyId={companyId} baselineRunId={link.baselineRunId} />;
  return <CatalogLive companyId={companyId} />;
}

/** Timeline workspace route body. A missing service connection stays visible, never faked. */
export function WorkspaceLive({ companyId }: { companyId: string }) {
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
        <Connected companyId={companyId} />
      ) : (
        <Notice title="Cannot open saved scenarios here">
          This page is not connected to the forecast service, so saved scenarios cannot be opened or
          created.
        </Notice>
      )}
    </Suspense>
  );
}
