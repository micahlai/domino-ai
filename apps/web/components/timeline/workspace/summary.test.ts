import { describe, expect, it } from "vitest";
import { fixtureRoot, fixtureRules, fixtureScenario } from "./fixtures";
import { floorReceipt, runHeadline } from "./summary";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("plain-language run summary", () => {
  it("answers with the saved breach week, or that cash stays above, or the low point", () => {
    expect(runHeadline(fixtureScenario)).toBe(
      "Cash falls below the $3,150,000.00 minimum in the week of Dec 14, 2026",
    );
    expect(runHeadline(fixtureRules)).toMatch(/^Cash stays above the \$3,150,000\.00 minimum/);
    expect(runHeadline(fixtureRoot)).toMatch(/^Lowest cash is \$/);
  });

  it("prefers the earliest breached minimum over a higher clear one", () => {
    const run = clone(fixtureScenario);
    const breached = run.receipts[0]!;
    run.receipts.push({
      ...breached,
      constraintId: "higher",
      status: "clear",
      relation: "clear",
      limit: breached.limit + 100,
      shortfall: null,
    });
    expect(floorReceipt(run)?.constraintId).toBe(breached.constraintId);
  });
});
