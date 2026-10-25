"use client";
import { useState } from "react";
import { ChatView } from "../timeline/chat/ChatView";
import { fixtureChat } from "../timeline/chat/fixtures";
import { fixtureWorkerContext } from "../timeline/chat/workerFixture";
import { fixtureRoot } from "../timeline/workspace/fixtures";
import { Button } from "../ui/button";
import { SuggestionsSection } from "./worker/SuggestionsSection";
import type { Suggestion } from "./worker/suggestions";

const suggestion: Suggestion = {
  id: fixtureWorkerContext.candidate.suggestionId,
  scenarioId: fixtureWorkerContext.scenario.id,
  scenarioTitle: fixtureWorkerContext.scenario.title,
  runId: fixtureWorkerContext.runId,
  snapshotVersion: 1,
  fix: { kind: "credit_line_draw", label: fixtureWorkerContext.candidate.fix.label },
  effect: {
    lowPointCents: 322_700_000,
    lowPointWeek: "2027-01-18",
    staysAboveMinimum: true,
    scenarioLow: 298_700_000,
    lenderMinimum: 315_000_000,
  },
  recommendation: "Labelled fixture: compare the saved risk and suggested fix.",
  status: "open",
  by: "Engine-tested fixture",
};
export function WorkerTimelinePlayground() {
  const [note, setNote] = useState<string | null>(null);
  const [declined, setDeclined] = useState<string | null>(null);
  const receipt = {
    ...fixtureChat,
    revision: 0,
    pendingField: null,
    workerContext: { ...fixtureWorkerContext, note: note ?? "" },
    turns: [
      {
        ...fixtureChat.turns[0]!,
        text: "The Worker risk, fix, saved calculations and optional note are ready. What would you like to explore?",
      },
    ],
  };
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <p className="text-sm text-muted-foreground">
        Visual fixture only. No backend, provider call, payment or approval.
      </p>
      {note === null ? (
        <SuggestionsSection
          state={{
            kind: "ready",
            list: [
              declined === null
                ? suggestion
                : { ...suggestion, status: "declined", note: declined },
            ],
          }}
          context={{ baseline: null, scenarios: new Map(), minimum: 315_000_000 }}
          companyId="worker-fixture-company"
          onDecide={async (_suggestion, _decision, value) => setDeclined(value)}
          onSimulate={async (_suggestion, value) => setNote(value)}
        />
      ) : (
        <>
          <Button variant="outline" onClick={() => setNote(null)}>
            Back to Worker suggestions
          </Button>
          <div className="h-[42rem] rounded-lg border">
            <ChatView
              run={fixtureRoot}
              selected={{ state: "ready", value: receipt }}
              history={{ state: "ready", value: [receipt] }}
              actions={{ write: async () => ({ ok: false, message: "Visual fixture only." }) }}
            />
          </div>
        </>
      )}
    </div>
  );
}
