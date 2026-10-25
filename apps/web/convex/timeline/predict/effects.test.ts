import { describe, expect, it } from "vitest";
import { kestrelSeed, makeRun } from "../questions.fake-workspace.test-support";
import {
  CASH_YIELD_BPS,
  DEFAULT_RESPONSE,
  MAX_EFFECTS,
  type ProposedEffect,
  cashFloor,
  horizonOf,
  predict,
  screenEffects,
  screenResponse,
  spendNames,
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

describe("screenResponse", () => {
  // Kestrel's only growth bill is Northlight Marketing on 2026-11-15, and it has no billing plans.
  const big = {
    kind: "remove_cash" as const,
    date: "2026-11-03",
    amount: 300_000_000,
    label: "Lawsuit",
  };
  const hit = makeRun({ runId: "hit", parentRunId: "base", kind: "scenario", ownChanges: [big] });
  const agents = {
    respondFrom: "event" as const,
    growthSpend: ["northlight marketing", "Imaginary Ads"],
    spendCutPercent: 40,
    payrollCutPercent: 0,
    reactionDays: 0,
    growthSensitivity: 0.5,
    revenueLagDays: 28,
    likelihood: "likely" as const,
    reason: "A $3M judgment forces cuts.",
    evidence: ["Ask Domino: lawsuit"],
  };

  it("lists the open, non-critical spend the engine can scale", () => {
    expect(spendNames(hit)).toEqual(["Northlight Marketing"]);
  });

  it("by default picks growth spending and reacts to the cash rule two weeks late", () => {
    const out = screenResponse(hit, big.date, [], null);
    expect(out.source).toBe("default");
    expect(out.policy).toMatchObject({
      respondFrom: "breach",
      floor: cashFloor(hit),
      growthSpend: ["Northlight Marketing"],
      spendCutPercent: DEFAULT_RESPONSE.spendCutPercent,
    });
    // The two-week reaction lands after the Nov 15 marketing bill, so only the hiring freeze
    // applies: a share of each later payroll run, computed by the engine.
    expect(out.skipped).toBeNull();
    expect(out.notes[0]).toMatch(/^Left out \(spend\)/);
    expect(out.changes.length).toBeGreaterThan(0);
    expect(
      out.changes.every(
        (c) => c.kind === "add_cash" && c.label.startsWith("Response: payroll 5% lower"),
      ),
    ).toBe(true);
  });

  it("applies the agents' cut, drops the slowdown with no plans, and lists unknown spend", () => {
    const out = screenResponse(hit, big.date, [], agents);
    expect(out.source).toBe("agents");
    expect(out.skipped).toBeNull();
    expect(out.trigger?.date).toBe(big.date);
    expect(out.changes).toEqual([
      {
        kind: "scale_recurring",
        label: "Response: growth spending cut 40%",
        flows: "spend",
        names: ["Northlight Marketing"],
        percent: -40,
        fromDate: big.date,
      },
    ]);
    expect(out.notes[1]).toMatch(/^Left out \(billing\): /);
    expect(out.notes).toContain("Not in these books: Imaginary Ads");
  });

  it("skips a breach response when there is no cash rule", () => {
    const free = makeRun({
      runId: "free",
      parentRunId: "base",
      kind: "scenario",
      constraints: [],
      ownChanges: [big],
    });
    expect(screenResponse(free, big.date, [], null).skipped).toMatch(/no cash rule/);
  });

  it("puts the response before interest and moves the gap to the scenario", () => {
    const response = screenResponse(hit, big.date, [], agents);
    const result = predict(hit, base.forecast, big.date, [], response);
    expect(result.changes[0]).toEqual(response.changes[0]);
    const gap = result.forecast.weeks.map(
      (w, i) => w.usable - (hit.forecast.weeks[i]?.usable ?? 0),
    );
    expect(new Set(gap.filter((g) => g !== 0)).size).toBeGreaterThan(2);
  });
});
