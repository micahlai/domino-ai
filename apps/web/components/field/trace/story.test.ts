import type { FieldTrace } from "@/lib/field-trace-contract";
import { describe, expect, it } from "vitest";
import { traceProvenanceLine } from "./story";

const legacy = {
  run: { asOf: "2026-10-25", trigger: "manual", summary: null },
  selection: { scenarioId: null, fixKind: null },
  inputs: null,
  scenarios: [],
  candidates: [],
} as unknown as FieldTrace;

describe("exact Field run explanation", () => {
  it("shows only the selected run's pinned source period and report date", () => {
    const trace = {
      ...legacy,
      inputs: {
        provenance: {
          label: "2U historical reconstruction",
          periodStart: "2023-07-01",
          periodEnd: "2023-09-30",
          reportedAt: "2023-11-09",
        },
      },
    } as unknown as FieldTrace;
    expect(traceProvenanceLine(trace)).toBe(
      "2U historical reconstruction · Reconstructed ledger Jul 1, 2023 to Sep 30, 2023 · Public report Nov 9, 2023",
    );
    expect(traceProvenanceLine(legacy)).toBeNull();
  });
});
