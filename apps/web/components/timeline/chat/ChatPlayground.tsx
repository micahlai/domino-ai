"use client";
import { useState } from "react";
import { Button } from "../../ui/button";
import { formatExactCents } from "../baseline/format";
import { WorkspaceChart } from "../workspace/WorkspaceChart";
import { WorkspaceView } from "../workspace/WorkspaceView";
import { workspaceHref } from "../workspace/api";
import { fixtureEntryGraph, fixtureOpenedResponse } from "../workspace/entryFixture";
import { fixtureGraph, fixtureRoot, fixtureRules, fixtureScenario } from "../workspace/fixtures";
import { openedForecastReady } from "../workspace/forecastReveal";
import { ChatView } from "./ChatView";
import { fixtureChat, fixtureChatRun, fixtureReady, fixtureSaved } from "./fixtures";
/** Deliberately repeated layout-only notes; every plotted point uses an existing saved fixture. */
function CrowdedLabelsFixture() {
  const [week, setWeek] = useState<string | null>(null);
  const notes = [120_000, 125_000, 130_000, 135_000, 140_000, 145_000].map((shortfall, index) => ({
    weekStart: fixtureScenario.forecast.weeks[3 + Math.floor(index / 2)]!.weekStart,
    text: `Below the lender's working capital minimum · short ${formatExactCents(shortfall)} (layout example ${index + 1})`,
    short: `Short ${formatExactCents(shortfall)}`,
  }));
  return (
    <details id="crowded-label-fixture" className="rounded-lg border p-3">
      <summary className="min-h-11 cursor-pointer text-sm font-medium">
        Crowded chart labels fixture
      </summary>
      <p className="my-3 text-sm text-muted-foreground">
        Layout fixture only: six nearby notes and two close cash minimum labels. Lines use existing
        saved fixture forecasts; repeated example notes do not represent recalculated results. No
        requests are sent.
      </p>
      <div className="flex h-[34rem] min-w-0 flex-col rounded-lg border p-2">
        <WorkspaceChart
          fill
          history={fixtureScenario.baseline.history}
          forecast={fixtureScenario.forecast}
          forecastLabel="Late-payment forecast (fixture)"
          forecastRunId={fixtureScenario.runId}
          comparisons={[
            {
              runId: fixtureRoot.runId,
              label: "Base forecast (fixture)",
              href: "#crowded-label-fixture",
              forecast: fixtureRoot.forecast,
              color: "#2f6fde",
            },
          ]}
          items={[]}
          limits={[
            {
              id: "layout-limit-one",
              label: "Lender's working capital minimum",
              cents: 315_000_000,
            },
            {
              id: "layout-limit-two",
              label: "Second minimum (layout fixture)",
              cents: 314_500_000,
            },
          ]}
          breachedWeeks={notes.map((note) => note.weekStart)}
          breachNotes={notes}
          selectedWeek={week}
          onSelectWeek={setWeek}
        />
      </div>
    </details>
  );
}
/** The same saved-parent readiness gate used by a connected entry, with manual data delivery. */
function DelayedEntryFixture() {
  const [phase, setPhase] = useState<"idle" | "waiting" | "ready" | "shown">("idle");
  const [ids, setIds] = useState([
    fixtureRules.runId,
    fixtureScenario.runId,
    fixtureOpenedResponse.runId,
  ]);
  const reads = {
    [fixtureRoot.runId]: { state: "ready" as const, value: fixtureRoot },
    [fixtureRules.runId]: { state: "ready" as const, value: fixtureRules },
    [fixtureScenario.runId]:
      phase === "waiting"
        ? { state: "loading" as const }
        : { state: "ready" as const, value: fixtureScenario },
    [fixtureOpenedResponse.runId]: { state: "ready" as const, value: fixtureOpenedResponse },
  };
  const ready =
    phase === "ready" &&
    openedForecastReady(
      fixtureOpenedResponse,
      { state: "ready", value: fixtureEntryGraph },
      reads,
      ids,
      fixtureRoot.runId,
    );
  return (
    <details id="delayed-entry-fixture" className="rounded-lg border p-3">
      <summary className="min-h-11 cursor-pointer text-sm font-medium">
        Delayed saved scenario entry fixture
      </summary>
      <p className="my-3 text-sm text-muted-foreground">
        Open a saved scenario, then deliver its saved parent forecast. The incoming line waits for
        the parent and draws once. Hiding and showing it afterwards does not replay the draw. No
        service calls.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        <Button
          onClick={() => {
            setPhase("waiting");
            setIds([fixtureRules.runId, fixtureScenario.runId, fixtureOpenedResponse.runId]);
          }}
        >
          Open saved scenario (fixture)
        </Button>
        <Button disabled={phase !== "waiting"} onClick={() => setPhase("ready")}>
          Deliver saved parent forecast
        </Button>
        <output className="self-center text-sm" data-testid="entry-fixture-phase">
          {phase}
        </output>
      </div>
      {phase !== "idle" ? (
        <div className="h-[36rem] overflow-hidden rounded-lg border">
          <WorkspaceView
            run={fixtureOpenedResponse}
            parent={reads[fixtureScenario.runId]!}
            graph={{ state: "ready", value: fixtureEntryGraph }}
            baseRunId={fixtureRoot.runId}
            questions={{ state: "ready", value: [] }}
            resultRef={{ state: "missing" }}
            forecastNotice={
              phase === "waiting"
                ? "Reading the saved scenario and the forecast it branches from..."
                : undefined
            }
            comparisons={{
              ids,
              reads,
              onChange: setIds,
              waitingRunIds: phase === "waiting" ? [fixtureOpenedResponse.runId] : [],
              revealRunIds: ready ? [fixtureOpenedResponse.runId] : [],
              onReveal: () => setPhase("shown"),
            }}
            actions={{
              catalogHref: "#delayed-entry-fixture",
              hrefFor: () => "#delayed-entry-fixture",
              simulate: async () => ({ ok: false, message: "Fixture only." }),
              reviseRules: async () => ({ ok: false, message: "Fixture only." }),
              confirmProposal: async () => ({ ok: false, message: "Fixture only." }),
              relink: async () => ({ ok: false, message: "Fixture only." }),
            }}
          />
        </div>
      ) : null}
    </details>
  );
}
export function ChatPlayground() {
  const [mode, setMode] = useState<"new" | "clarify" | "ready" | "saved" | "error">("clarify");
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const receipt = mode === "ready" ? fixtureReady : mode === "saved" ? fixtureSaved : fixtureChat;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Labelled fixtures only. These controls show saved states; they do not calculate or write
        data.
      </p>
      <DelayedEntryFixture />
      <CrowdedLabelsFixture />
      <div className="flex flex-wrap gap-2">
        {(["new", "clarify", "ready", "saved", "error"] as const).map((value) => (
          <Button
            key={value}
            variant={mode === value ? "default" : "outline"}
            onClick={() => setMode(value)}
          >
            {value}
          </Button>
        ))}
      </div>
      <div className="h-[calc(100dvh-14rem)] min-h-[36rem] overflow-hidden rounded-lg border">
        <WorkspaceView
          key={mode}
          run={fixtureChatRun}
          parent={null}
          graph={{ state: "ready", value: fixtureGraph }}
          questions={{ state: "ready", value: [] }}
          resultRef={{ state: "missing" }}
          comparisons={{
            ids: comparisonIds,
            reads: {
              [fixtureRoot.runId]: { state: "ready", value: fixtureRoot },
              [fixtureRules.runId]: { state: "ready", value: fixtureRules },
              [fixtureScenario.runId]: { state: "ready", value: fixtureScenario },
            },
            onChange: setComparisonIds,
          }}
          actions={{
            catalogHref: "#",
            hrefFor: (runId) => workspaceHref(fixtureChatRun.companyId, { runId }),
            simulate: async () => ({ ok: false, message: "Fixture only: nothing was calculated." }),
            reviseRules: async () => ({ ok: false, message: "Fixture only: nothing was saved." }),
            confirmProposal: async () => ({
              ok: false,
              message: "Fixture only: nothing was saved.",
            }),
            relink: async () => ({ ok: false, message: "Fixture only: nothing was saved." }),
          }}
          chat={(context) => (
            <ChatView
              {...context}
              run={fixtureChatRun}
              selected={
                mode === "new"
                  ? null
                  : mode === "error"
                    ? { state: "error" }
                    : { state: "ready", value: receipt }
              }
              history={{
                state: "ready",
                value: [
                  fixtureChat,
                  { ...fixtureSaved, conversationId: "timeline:chat/saved-fixture" },
                ],
              }}
              actions={{
                write: async () => ({
                  ok: false,
                  message: "This is a visual fixture. Open a connected saved timeline to chat.",
                }),
              }}
            />
          )}
        />
      </div>
    </div>
  );
}
