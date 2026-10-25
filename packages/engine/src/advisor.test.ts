import type { Snapshot } from "@domino/contracts";
import { fixtures } from "@domino/contracts/fixtures";
import { describe, expect, it } from "vitest";
import {
  type AdvisorInput,
  adviseFix,
  advisorCandidates,
  rankAdvice,
  scenarioLow,
} from "./advisor";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const input = (changes: AdvisorInput["scenario"]["changes"], cash?: number): AdvisorInput => {
  const snapshot: Snapshot = clone(fixtures.snapshot);
  if (cash !== undefined) snapshot.cashOnHand = cash;
  return {
    snapshot,
    model: fixtures.model,
    constraints: fixtures.constraints,
    scenario: { id: "scn", label: "Scenario", changes },
  };
};
const LOSE = [{ kind: "lose_invoice" as const, invoiceId: "inv_nw_q4" }];

describe("advisor swarm", () => {
  it("offers no advisors when the scenario stays above the lender's minimum", () => {
    const rich = input(LOSE, 2_000_000_000);
    expect(scenarioLow(rich).belowMinimum).toBe(false);
    expect(advisorCandidates(rich)).toEqual([]);
  });

  it("offers one candidate per applicable fix kind when the scenario breaks the minimum", () => {
    const i = input(LOSE);
    const low = scenarioLow(i);
    expect(low).toMatchObject({
      belowMinimum: true,
      floor: 300_000_000,
      brokenConstraintId: "con_lender_min",
    });
    const kinds = advisorCandidates(i).map((c) => c.kind);
    expect(kinds).toEqual(["credit_line_draw", "delay_bill", "accelerate_collections"]);
    // The scenario's own lost invoice is never offered for early collection.
    const early = advisorCandidates(i).find((c) => c.kind === "accelerate_collections");
    expect(JSON.stringify(early?.fix.changes)).not.toContain("inv_nw_q4");
  });

  it("adds defer hires only when the scenario plans hires", () => {
    const hires = input([
      ...LOSE,
      { kind: "remove_cash", date: "2026-11-13", amount: 2_000_000, label: "Planned hires" },
    ]);
    expect(advisorCandidates(hires).map((c) => c.kind)).toContain("defer_hires");
  });

  it("computes each fix's effect deterministically; the credit line draw survives", () => {
    const i = input(LOSE);
    const results = advisorCandidates(i).map((candidate) => ({
      candidate,
      effect: adviseFix(i, candidate),
    }));
    const again = advisorCandidates(i).map((candidate) => ({
      candidate,
      effect: adviseFix(i, candidate),
    }));
    expect(again).toEqual(results);
    const draw = results.find((r) => r.candidate.kind === "credit_line_draw");
    expect(draw?.effect.survives).toBe(true);
    expect(draw?.effect.lowPoint).toBeGreaterThanOrEqual(300_000_000);
    for (const r of results) {
      expect(Number.isInteger(r.effect.lowPoint)).toBe(true);
      expect(r.effect.gain).toBe(r.effect.lowPoint - scenarioLow(i).low);
    }
    expect(rankAdvice([...results].reverse())[0]?.candidate.kind).toBe("credit_line_draw");
  });
});
