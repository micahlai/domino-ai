"use client";

import { useState } from "react";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { CatalogList } from "./CatalogPanel";
import { type WorkspaceActions, WorkspaceView } from "./WorkspaceView";
import { fixtureGraph, fixtureQuestions, fixtureRuns } from "./fixtures";

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
    ask: refuse,
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
      {run ? (
        <WorkspaceView
          key={run.runId}
          run={run}
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
        />
      ) : null}
    </section>
  );
}
