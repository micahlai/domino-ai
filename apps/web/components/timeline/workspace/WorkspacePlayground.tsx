"use client";

import { useState } from "react";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { CatalogList } from "./CatalogPanel";
import { PredictionView } from "./PredictionControl";
import { type WorkspaceActions, WorkspaceView } from "./WorkspaceView";
import type { WorkspaceRun } from "./api";
import { fixtureGraph, fixtureQuestions, fixtureRuns } from "./fixtures";
import { donePrediction, runningPrediction } from "./predictionFixtures";
import { comparisonIds } from "./scenarioComparisons";

const NOTHING_SAVED = "Playground fixture: nothing is saved or calculated here.";

/** Fixture-only workspace for the playground. Every write answers honestly that nothing ran. */
export function WorkspacePlayground() {
  const ids = Object.keys(fixtureRuns);
  const [runId, setRunId] = useState(ids[ids.length - 1] ?? "");
  const run = fixtureRuns[runId as keyof typeof fixtureRuns];
  const refuse = async () => ({ ok: false as const, message: NOTHING_SAVED });
  const actions: WorkspaceActions = {
    catalogHref: "#workspace-catalog",
    hrefFor: (id) => `#${encodeURIComponent(id)}`,
    simulate: refuse,
    reviseRules: refuse,
    confirmProposal: refuse,
    relink: refuse,
  };
  return (
    <section className="space-y-4" data-testid="workspace-playground">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="border-dashed text-clay">
          Workspace fixture
        </Badge>
        {ids.map((id) => (
          <Button
            key={id}
            size="sm"
            variant={id === runId ? "default" : "secondary"}
            onClick={() => setRunId(id)}
          >
            {fixtureRuns[id as keyof typeof fixtureRuns].label}
          </Button>
        ))}
      </div>
      <div id="workspace-catalog">
        <CatalogList
          pages={[
            {
              state: "ready",
              value: { entries: [...fixtureGraph].reverse(), isDone: false, continueCursor: "c1" },
            },
            { state: "loading" },
          ]}
          onMore={() => undefined}
          hrefFor={actions.hrefFor}
        />
      </div>
      <div className="h-[calc(100dvh-10rem)] min-h-[36rem] overflow-hidden rounded-lg border">
        {run ? <FixtureWorkspace key={run.runId} run={run} actions={actions} /> : null}
      </div>
    </section>
  );
}

function FixtureWorkspace({ run, actions }: { run: WorkspaceRun; actions: WorkspaceActions }) {
  const [ids, setIds] = useState<string[]>(
    run.parentRunId
      ? [run.parentRunId]
      : fixtureGraph
          .filter((entry) => entry.parentRunId === run.runId)
          .slice(0, 1)
          .map((entry) => entry.runId),
  );
  return (
    <WorkspaceView
      run={run}
      comparisons={{
        ids: comparisonIds(ids, run.runId),
        reads: Object.fromEntries(
          Object.entries(fixtureRuns).map(([id, value]) => [
            id,
            { state: "ready" as const, value },
          ]),
        ),
        onChange: setIds,
      }}
      parent={
        run.parentRunId
          ? { state: "ready", value: fixtureRuns[run.parentRunId as keyof typeof fixtureRuns] }
          : null
      }
      graph={{ state: "ready", value: fixtureGraph }}
      questions={{
        state: "ready",
        value: fixtureQuestions.map((q) => ({ ...q, runId: run.runId })),
      }}
      resultRef={{ state: "missing" }}
      actions={actions}
      // Fixture prediction states: the first scenario is still running, the rest are done.
      scenarioRowExtra={({ runId, name }) => (
        <PredictionView
          name={name}
          prediction={runId === fixtureGraph[1]?.runId ? runningPrediction : donePrediction}
        />
      )}
    />
  );
}
