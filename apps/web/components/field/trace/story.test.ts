import type { FieldTrace } from "@/lib/field-trace-contract";
import { describe, expect, it } from "vitest";
import { traceStory } from "./story";

const legacy = {
  run: { asOf: "2026-10-25", trigger: "manual", summary: null },
  selection: { scenarioId: null, fixKind: null },
  inputs: null,
  scenarios: [],
  candidates: [],
} as unknown as FieldTrace;

describe("exact Field run explanation", () => {
  it("states when a legacy receipt cannot support a result", () => {
    const story = traceStory(legacy);
    expect(story.data).toContain("not saved");
    expect(story.checked).toContain("No completed scenario calculation");
    expect(story.outcome).toContain("no saved result");
  });

  it("uses only the chosen run's saved fix and rationale", () => {
    const trace = {
      ...legacy,
      inputs: { company: { name: "Saved company" }, snapshot: { asOf: "2026-10-25" }, sources: [] },
      selection: { scenarioId: "scenario-old", fixKind: "delay_bill" },
      scenarios: [
        {
          id: "scenario-old",
          title: "Customer pays late",
          basis: "Invoice delayed.",
          changes: [{}],
          work: { weeks: [{ weekStart: "2026-10-26" }], low: 10000, survives: false },
        },
      ],
      candidates: [
        {
          scenarioId: "scenario-old",
          fix: { kind: "delay_bill", label: "Delay bill" },
          effect: { survives: true, lowPoint: 12000, lowWeekStart: "2026-10-26" },
          recommendation: { text: "Keeps the minimum clear." },
        },
      ],
    } as unknown as FieldTrace;
    const story = traceStory(trace);
    expect(story.data).toContain("Saved company");
    expect(story.title).toBe("Why Delay bill?");
    expect(story.outcome).toContain("Keeps the minimum clear.");
  });

  it("does not invent an outcome for a failed scenario without saved work", () => {
    const trace = {
      ...legacy,
      scenarios: [
        { id: "failed", title: "Failed case", basis: "Recorded input", changes: [], work: null },
      ],
      selection: { scenarioId: "failed", fixKind: null },
    } as unknown as FieldTrace;
    const story = traceStory(trace);
    expect(story.checked).toContain("No completed scenario calculation");
    expect(story.outcome).toContain("no saved result");
  });
});
