"use client";

import { type ActivityEvent, ActivityEventSchema } from "@domino/contracts";
import { useState } from "react";
import { ActivityPanel } from "./ActivityPanel";
import { Button } from "./ui/button";

// Fixed synthetic events to look at the panel's motion. Nothing here ran: no agent, tool or run
// exists behind these ids, and the real app never imports this file.
const scope = { caseId: "sim-case", runId: "sim-run" };
let seq = 0;
const ev = (
  id: string,
  kind: ActivityEvent["kind"],
  status: ActivityEvent["status"],
  entity: ActivityEvent["entity"],
  label: string,
  extra: Partial<ActivityEvent> = {},
) =>
  ActivityEventSchema.parse({
    id,
    sequence: ++seq,
    occurredAt: `2026-01-01T09:00:${String(seq).padStart(2, "0")}Z`,
    ...scope,
    kind,
    status,
    entity,
    label,
    ...extra,
  });

const task = { kind: "agent_task", id: "sim-task-1" } as const;
const task2 = { kind: "agent_task", id: "sim-task-2" } as const;
const tool = { kind: "tool", id: "sim-tool-1" } as const;
const alt = { kind: "comparison", id: "sim-branch-1" } as const;

const steps: { caption: string; events: ActivityEvent[] }[] = [
  { caption: "A task starts", events: [ev("s1", "agent_task", "started", task, "Sample task")] },
  {
    caption: "A tool is registered",
    events: [ev("s2", "tool_registered", "succeeded", tool, "Sample lookup tool")],
  },
  {
    caption: "The tool is used; a second task starts",
    events: [
      ev("s3", "tool_invoked", "started", tool, "Sample lookup tool", {
        evidenceIds: ["sim-ev-1"],
      }),
      ev("s4", "agent_task", "started", task2, "Second sample task"),
    ],
  },
  {
    caption: "The tool finishes; the first task completes; the second task fails",
    events: [
      ev("s5", "tool_invoked", "succeeded", tool, "Sample lookup tool", {
        evidenceIds: ["sim-ev-1"],
        outputId: "sim-out-1",
      }),
      ev("s6", "agent_task", "succeeded", task, "Sample task", { outputId: "sim-out-2" }),
      ev("s7", "agent_task", "failed", task2, "Second sample task"),
    ],
  },
  {
    caption: "A run is saved",
    events: [
      ev("s8", "run_saved", "succeeded", { kind: "run", id: "sim-run" }, "Sample forecast saved"),
    ],
  },
  {
    caption: "A branch fails",
    events: [ev("s9", "alternative_computed", "failed", alt, "Sample alternative")],
  },
  {
    caption: "A retry of the branch succeeds",
    events: [ev("s10", "alternative_computed", "succeeded", alt, "Sample alternative")],
  },
  { caption: "Reconnect: earlier events arrive again, out of order. Nothing replays.", events: [] },
];
// The last step redelivers everything already shown, newest first.
steps[steps.length - 1]?.events.push(
  ...steps
    .slice(0, -1)
    .flatMap((s) => s.events)
    .reverse(),
);

export function ActivitySimulation() {
  const [shown, setShown] = useState(0);
  const [round, setRound] = useState(0);
  const delivered = steps.slice(0, shown).flatMap((s) => s.events);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Simulation preview: synthetic events to test the motion. No agent, tool or timer is running.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={shown >= steps.length} onClick={() => setShown(shown + 1)}>
          Step
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setShown(0);
            setRound(round + 1);
          }}
        >
          Replay
        </Button>
        <span className="text-sm text-muted-foreground">
          {shown
            ? `Step ${shown} of ${steps.length}: ${steps[shown - 1]?.caption}`
            : `${steps.length} steps`}
        </span>
      </div>
      <ActivityPanel key={round} events={delivered} scope={scope} source="simulation" />
    </div>
  );
}
