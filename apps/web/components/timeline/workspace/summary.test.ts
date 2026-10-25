import { describe, expect, it } from "vitest";
import { fixtureGraph, fixtureRoot, fixtureRules, fixtureScenario } from "./fixtures";
import { entryOutcome, floorReceipt, receiptOutcome, runHeadline } from "./summary";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("plain-language run summary", () => {
  it("answers with the saved breach week, or that cash stays above, or the low point", () => {
    expect(runHeadline(fixtureScenario)).toBe(
      "Cash falls below the $3,150,000.00 minimum in the week of Dec 14, 2026",
    );
    expect(runHeadline(fixtureRules)).toMatch(/^Cash stays above the \$3,150,000\.00 minimum/);
    expect(runHeadline(fixtureRoot)).toMatch(/^Lowest cash is \$/);
  });

  it("reads outcome and shortfall only from saved receipts", () => {
    expect(receiptOutcome(fixtureScenario)).toEqual({
      tone: "below",
      text: "Falls below minimum",
      detail: "first below in the week of Dec 14, 2026, short $33,000.00",
    });
    expect(receiptOutcome(fixtureRules)?.tone).toBe("above");
    expect(receiptOutcome(fixtureRoot)).toBeNull();
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

  it("judges unopened rows only under the same rules, exactly like the engine (strictly below)", () => {
    const entry = { ...fixtureGraph[0]!, constraintVersion: fixtureScenario.constraintVersion };
    const limit = floorReceipt(fixtureScenario)!.limit;
    expect(entryOutcome({ ...entry, lowPointCents: limit - 1 }, fixtureScenario)?.tone).toBe(
      "below",
    );
    expect(entryOutcome({ ...entry, lowPointCents: limit }, fixtureScenario)?.tone).toBe("above");
    expect(
      entryOutcome({ ...entry, constraintVersion: "other", lowPointCents: 0 }, fixtureScenario),
    ).toBeNull();
    expect(entryOutcome(entry, fixtureRoot)).toBeNull();
  });
});
