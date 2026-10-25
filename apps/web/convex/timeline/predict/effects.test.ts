import { describe, expect, it } from "vitest";
import { kestrelSeed, makeRun } from "../questions.fake-workspace.test-support";
import {
  CASH_YIELD_BPS,
  MAX_EFFECTS,
  type ProposedEffect,
  horizonOf,
  predict,
  screenEffects,
} from "./effects";

const snapshot = kestrelSeed.snapshot;
const base = makeRun({ runId: "base" });
const horizon = horizonOf(base);
/** Open invoices the forecast still expects, soonest first. */
const open = snapshot.invoices
  .filter((i) => i.paid === undefined && i.writtenOff === undefined)
  .filter((i) => i.due > horizon.asOf && i.due <= horizon.end)
  .sort((a, b) => (a.due < b.due ? -1 : 1));
const first = open[0];
const later = open[open.length - 1];
if (!first || !later || first.id === later.id) throw new Error("fixture needs two open invoices");

/** A one-time $500K payment on the first open invoice's due date. */
const payment = {
  kind: "remove_cash" as const,
  date: first.due,
  amount: 50_000_000,
  label: "Generic purchase",
};
const scenario = makeRun({
  runId: "scenario",
  parentRunId: "base",
  kind: "scenario",
  ownChanges: [payment],
});

const effect = (over: Partial<ProposedEffect>): ProposedEffect => ({
  kind: "delay_invoice",
  recordId: later.id,
  days: 14,
  fromDate: null,
  title: "Customer pays two weeks late",
  reason: "Brain map shows this customer slowed payments after past shocks.",
  likelihood: "possible",
  evidence: ["Learned payment delay"],
  ...over,
});

describe("screenEffects", () => {
  it("turns an accepted proposal into an engine change without any amount", () => {
    const { accepted, rejected } = screenEffects(scenario, payment.date, [effect({})]);
    expect(rejected).toEqual([]);
    expect(accepted[0]?.change).toEqual({ kind: "delay_invoice", invoiceId: later.id, days: 14 });
  });

  it("rejects unknown records, missing days and effects before the event", () => {
    const { accepted, rejected } = screenEffects(scenario, later.due, [
      effect({ recordId: "inv_missing", title: "a" }),
      effect({ days: null, title: "b" }),
      effect({ recordId: first.id, title: "c" }),
    ]);
    expect(accepted).toEqual([]);
    expect(rejected.map((r) => r.title)).toEqual(["a", "b", "c"]);
    expect(rejected[0]?.reason).toMatch(/No invoice/);
    expect(rejected[1]?.reason).toMatch(/1 to 120 days/);
    expect(rejected[2]?.reason).toMatch(/before the scenario's event/);
  });

  it("keeps one effect per record", () => {
    const { accepted, rejected } = screenEffects(scenario, payment.date, [
      effect({}),
      effect({ kind: "lose_invoice", days: null, title: "lost" }),
    ]);
    expect(accepted).toHaveLength(1);
    expect(rejected[0]?.reason).toMatch(/already changed/);
  });

  it("uses at most MAX_EFFECTS effects", () => {
    const many = Array.from({ length: MAX_EFFECTS + 2 }, (_, i) =>
      effect({ recordId: open[i % open.length]?.id ?? later.id, title: `e${i}` }),
    );
    const { accepted, rejected } = screenEffects(scenario, null, many);
    expect(accepted.length).toBeLessThanOrEqual(MAX_EFFECTS);
    expect(accepted.length + rejected.length).toBe(many.length);
  });
});

describe("predict", () => {
  it("bends the scenario line away from its parent instead of shifting it", () => {
    const result = predict(scenario, base.forecast, payment.date, []);
    expect(result.interest?.annualBps).toBe(CASH_YIELD_BPS);
    expect(result.interest?.netCents).toBeLessThan(0);
    const gap = (i: number) =>
      (base.forecast.weeks[i]?.closing ?? 0) - (result.forecast.weeks[i]?.closing ?? 0);
    const last = result.forecast.weeks.length - 1;
    // The plain scenario stays exactly $500K below; the prediction falls further behind.
    expect(gap(last)).toBeGreaterThan(50_000_000);
  });

  it("is deterministic", () => {
    const effects = screenEffects(scenario, payment.date, [effect({})]).accepted;
    expect(predict(scenario, base.forecast, payment.date, effects)).toEqual(
      predict(scenario, base.forecast, payment.date, effects),
    );
  });

  it("adds no interest when nothing changes cash", () => {
    const same = makeRun({ runId: "same", parentRunId: "base", kind: "scenario" });
    expect(predict(same, base.forecast, null, []).changes).toEqual([]);
  });
});
