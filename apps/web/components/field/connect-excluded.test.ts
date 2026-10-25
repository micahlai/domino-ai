import { describe, expect, it } from "vitest";
import type { ToolId } from "../../convex/connectors/types";
import demo from "./connect-demo.json";
import { groupSkips, reasonText, skipGroup } from "./connect-excluded";
import { demoExcluded } from "./connect-receipts";

type Run = { tool: ToolId; skipped: number };
const RUNS = demo.runs as unknown as Record<string, Run[]>;

describe("excluded records", () => {
  it("groups receipt reasons and drops record ids", () => {
    expect(skipGroup("same record as Stripe in_0042")).toBe("duplicates");
    expect(skipGroup("payroll totals do not add up")).toBe("errors");
    expect(skipGroup("pending: counted once it posts")).toBe("unsupported");
    expect(reasonText("same record as Stripe in_0042")).toBe("Same record as Stripe");
    expect(
      groupSkips([
        { id: "a", reason: "same record as Stripe in_1" },
        { id: "b", reason: "same record as Stripe in_2" },
        { id: "c", reason: "declined card charge" },
      ]),
    ).toEqual([
      { group: "duplicates", reason: "Same record as Stripe", count: 2 },
      { group: "unsupported", reason: "Declined card charge", count: 1 },
    ]);
  });

  it("reconciles with the recorded demo counts for every tool", async () => {
    const all: ToolId[] = ["gusto", "hubspot", "plaid", "qbo", "ramp", "stripe"];
    const report = await demoExcluded(all);
    const recorded = RUNS[all.join(",")] ?? [];
    for (const run of recorded) {
      const mine = report.find((r) => r.tool === run.tool);
      const total = (mine?.reasons ?? []).reduce((n, r) => n + r.count, 0);
      expect(total, run.tool).toBe(run.skipped);
    }
    // Reasons read as sentences, not ids.
    for (const r of report.flatMap((t) => t.reasons)) expect(r.reason).not.toMatch(/_/);
  }, 60_000);
});
