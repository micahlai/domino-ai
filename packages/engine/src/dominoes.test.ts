import {
  type Bill,
  type Change,
  type CompanyModel,
  type Constraint,
  type Domino,
  DominoSchema,
  type Forecast,
  type Invoice,
  type Snapshot,
} from "@domino/contracts";
import { WEEK_STARTS, fixtures } from "@domino/contracts/fixtures";
import { describe, expect, it } from "vitest";
import { dominoes } from "./dominoes";
import { cashSchedule, forecast } from "./forecast";
import { fundingDays } from "./funding";
import { evaluateRules } from "./rules";

// asOf Friday 2026-10-30: daily replay runs 2026-10-31 .. Sunday 2027-01-31 (WEEK_STARTS[12] + 6).
const W = WEEK_STARTS;
const noModel: CompanyModel = { version: 0, customerDelayDays: {}, recurringSpend: [], rules: [] };
const doc = (ref: string) => ({ source: "document" as const, ref, note: "Terms" });

function snap(cash: number, extra: Partial<Snapshot> = {}): Snapshot {
  return {
    companyId: "t",
    asOf: "2026-10-30",
    cashOnHand: cash,
    restrictedCash: 0,
    customers: [{ id: "c1", name: "Cobalt", paymentTermsDays: 30 }],
    invoices: [],
    bankTxns: [],
    bills: [],
    cardTxns: [],
    payroll: [],
    deals: [],
    ...extra,
  };
}
const inv = (id: string, amount: number, due: string): Invoice => ({
  id,
  customerId: "c1",
  amount,
  issued: "2026-10-01",
  due,
});
const bill = (id: string, amount: number, due: string, extra: Partial<Bill> = {}): Bill => ({
  id,
  vendor: `Vendor ${id}`,
  amount,
  due,
  critical: false,
  ...extra,
});
const run = (id: string, amount: number, date: string) => ({ id, amount, date });

const minCash = (id: string, limit: number, extra: Partial<Constraint> = {}): Constraint => ({
  id,
  label: "Cash floor",
  kind: "min_cash",
  limit,
  evidence: doc("loan.pdf#7"),
  ...extra,
});
const payBy = (billId: string, limit: number, id = `pay_${billId}`): Constraint => ({
  id,
  label: "Vendor terms",
  kind: "pay_by_date",
  limit,
  billId,
  evidence: doc("vendor-terms.pdf#3"),
});
const runway = (limit: number): Constraint => ({
  id: "con_runway",
  label: "Runway policy",
  kind: "min_runway_months",
  limit,
  evidence: doc("board.pdf#2"),
});

/** dominoes with full context (unless noContext); every result must parse DominoSchema. */
function domino(
  s: Snapshot,
  constraints: Constraint[],
  changes: Change[] = [],
  opts: { baseline?: boolean; noContext?: boolean } = {},
): Domino[] {
  const f = forecast(s, noModel, changes);
  const context = opts.noContext
    ? undefined
    : {
        model: noModel,
        changes,
        ...(opts.baseline ? { baseline: forecast(s, noModel, []) } : {}),
      };
  const out = dominoes(f, constraints, s, context);
  for (const d of out) expect(DominoSchema.parse(d)).toEqual(d);
  return out;
}
const status = (s: Snapshot, c: Constraint, changes: Change[] = []) =>
  evaluateRules(s, forecast(s, noModel, changes), [c], { model: noModel, changes })[0];
const funded = (s: Snapshot, changes: Change[] = []) =>
  Object.fromEntries(fundingDays(s, cashSchedule(s, noModel, changes)));

describe("min_cash", () => {
  const flat = snap(1_000_000, { restrictedCash: 100_000 }); // usable 900,000 every week
  // Payroll: usable 900k in weeks 0-1, 800k in weeks 2-4, 700k from week 5.
  const stepped = snap(900_000, {
    payroll: [run("p1", 100_000, "2026-11-20"), run("p2", 100_000, "2026-12-11")],
  });

  it("breaks only strictly below the limit, using usable cash", () => {
    expect(domino(flat, [minCash("floor", 900_000)], [], { noContext: true })).toEqual([]);
    expect(domino(flat, [minCash("floor", 900_001)], [], { noContext: true })).toEqual([
      {
        order: 1,
        weekStart: W[0],
        label: "Usable cash falls to $9,000, below Cash floor of $9,000.01",
        constraintId: "floor",
        evidence: [doc("loan.pdf#7")],
      },
    ]);
  });

  it("reports only the first breach week", () => {
    const out = domino(stepped, [minCash("floor", 850_000)]);
    expect(out.map((d) => [d.order, d.weekStart, d.constraintId])).toEqual([[1, W[2], "floor"]]);
  });

  it("orders several constraints by week, then ID, the same way for any input order", () => {
    const cs = [
      minCash("z_floor", 850_000),
      minCash("m_floor", 750_000),
      minCash("a_floor", 850_000),
    ];
    const out = domino(stepped, cs);
    expect(out.map((d) => [d.order, d.weekStart, d.constraintId])).toEqual([
      [1, W[2], "a_floor"],
      [2, W[2], "z_floor"],
      [3, W[5], "m_floor"],
    ]);
    expect(domino(stepped, [...cs].reverse())).toEqual(out);
    expect(domino(stepped, cs)).toEqual(out);
  });

  it("does not mutate its inputs", () => {
    const s = structuredClone(stepped);
    const cs = [minCash("floor", 850_000)];
    const f = forecast(s, noModel, []);
    const ctx = { model: noModel, changes: [], baseline: f };
    const copies = structuredClone([s, cs, f, ctx]);
    dominoes(f, cs, s, ctx);
    expect([s, cs, f, ctx]).toEqual(copies);
  });
});

describe("rule inputs that cannot be evaluated are rejected", () => {
  const s = snap(1000, { bills: [bill("b1", 500, "2026-11-03")] });
  const f = forecast(s, noModel, []);
  const ctx = { model: noModel, changes: [] };
  it("rules other than min_cash need context", () => {
    expect(() => dominoes(f, [payBy("b1", 0)], s)).toThrow(/needs calculation context/);
    expect(() => dominoes(f, [runway(1)], s)).toThrow(/needs calculation context/);
  });
  it("pay_by_date needs a bill target that exists", () => {
    const { billId: _, ...legacy } = payBy("b1", 0);
    expect(() => dominoes(f, [legacy], s, ctx)).toThrow(/no billId/);
    expect(() => dominoes(f, [payBy("nope", 0)], s, ctx)).toThrow(/unknown bill nope/);
  });
  it("unknown change targets, mismatched forecasts and duplicate constraint IDs throw", () => {
    const lost: Change[] = [{ kind: "lose_invoice", invoiceId: "nope" }];
    expect(() => dominoes(f, [], s, { model: noModel, changes: lost })).toThrow(/nope/);
    const delayed: Change[] = [{ kind: "delay_bill", billId: "b1", days: 14 }];
    expect(() => dominoes(f, [], s, { model: noModel, changes: delayed })).toThrow(
      /does not match/,
    );
    expect(() => dominoes(f, [minCash("x", 0), minCash("x", 1)], s)).toThrow(/duplicate/);
  });
});

describe("pay_by_date daily funding", () => {
  const b1 = bill("b1", 500, "2026-11-03"); // Tuesday of week 0

  it("passes with enough usable cash and fails when only restricted cash covers the bill", () => {
    expect(domino(snap(1000, { bills: [b1] }), [payBy("b1", 0)])).toEqual([]);
    const restricted = snap(1000, { restrictedCash: 900, bills: [b1] });
    expect(domino(restricted, [payBy("b1", 0)])).toEqual([
      {
        order: 1,
        weekStart: W[0],
        label:
          "Projected funding shortfall: $5 bill from Vendor b1 is not funded by its 2026-11-03 deadline",
        constraintId: "pay_b1",
        evidence: [
          doc("vendor-terms.pdf#3"),
          {
            source: "books",
            ref: "b1",
            note: "Not projected to be funded by its 2026-11-03 deadline",
          },
        ],
      },
    ]);
  });

  it("fails on a midweek shortage even when the weekly close is healthy", () => {
    const s = snap(100, { bills: [b1], invoices: [inv("i1", 1000, "2026-11-05")] });
    expect(forecast(s, noModel, []).weeks[0]?.usable).toBe(600); // 100 + 1000 - 500
    expect(funded(s)).toEqual({ b1: "2026-11-05" });
    const out = domino(s, [minCash("floor", 0), payBy("b1", 0)]);
    expect(out.map((d) => d.constraintId)).toEqual(["pay_b1"]);
    expect(status(s, payBy("b1", 0))?.breach).toMatchObject({ fundedOn: "2026-11-05" });
  });

  it("counts a receipt on the deadline day before the bill (same-day inflow first)", () => {
    const s = snap(100, { bills: [b1], invoices: [inv("i1", 1000, "2026-11-03")] });
    expect(funded(s)).toEqual({ b1: "2026-11-03" });
    expect(status(s, payBy("b1", 0))?.status).toBe("clear");
  });

  it("recovery on or before the deadline passes; recovery after it cannot cure the breach", () => {
    const s = snap(100, { bills: [b1], invoices: [inv("i1", 1000, "2026-11-05")] });
    expect(status(s, payBy("b1", 2))?.status).toBe("clear"); // deadline 11-05
    expect(status(s, payBy("b1", 5))?.status).toBe("clear"); // deadline 11-08
    expect(status(s, payBy("b1", 1))?.status).toBe("breached"); // deadline 11-04
  });

  it("funds competing bills by date then ID, in full, with no leapfrogging", () => {
    const sameDay = snap(600, {
      bills: [bill("b", 400, "2026-11-03"), bill("a", 500, "2026-11-03")],
    });
    expect(funded(sameDay)).toEqual({ a: "2026-11-03" });
    expect(status(sameDay, payBy("a", 0))?.status).toBe("clear");
    expect(status(sameDay, payBy("b", 0))?.status).toBe("breached");
    // The unaffordable head blocks a smaller later bill until cash arrives on 11-06.
    const blocked = snap(600, {
      bills: [bill("a", 700, "2026-11-03"), bill("b", 100, "2026-11-04")],
      invoices: [inv("i1", 200, "2026-11-06")],
    });
    expect(funded(blocked)).toEqual({ a: "2026-11-06", b: "2026-11-06" });
    expect(status(blocked, payBy("b", 1))?.status).toBe("breached"); // deadline 11-05
    expect(status(blocked, payBy("b", 2))?.status).toBe("clear"); // deadline 11-06
  });

  it("deducts every bill exactly once and reserves non-bill outflows first", () => {
    const three = snap(1000, {
      bills: [
        bill("a", 500, "2026-11-03"),
        bill("b", 500, "2026-11-04"),
        bill("c", 1, "2026-11-05"),
      ],
    });
    expect(funded(three)).toEqual({ a: "2026-11-03", b: "2026-11-04" });
    const payroll = snap(1000, { bills: [b1], payroll: [run("p1", 600, "2026-11-03")] });
    expect(status(payroll, payBy("b1", 0))?.status).toBe("breached");
    const withReceipt = { ...payroll, invoices: [inv("i1", 200, "2026-11-03")] };
    expect(status(withReceipt, payBy("b1", 0))?.status).toBe("clear"); // 1000 + 200 - 600 >= 500
  });

  it("fails a payment scheduled after the deadline even with plenty of cash", () => {
    const s = snap(1_000_000, { bills: [b1] });
    const late: Change[] = [{ kind: "delay_bill", billId: "b1", days: 7 }]; // 11-10 > 11-08
    expect(status(s, payBy("b1", 5), [{ kind: "delay_bill", billId: "b1", days: 5 }])?.status).toBe(
      "clear",
    );
    const out = domino(s, [payBy("b1", 5)], late);
    expect(out.map((d) => [d.order, d.weekStart, d.constraintId, d.causedBy])).toEqual([
      [1, W[0], undefined, undefined],
      [2, W[0], "pay_b1", undefined],
    ]);
    expect(out[0]?.label).toBe("$5 payment to Vendor b1 moves from 2026-11-03 to 2026-11-10");
    expect(out[1]?.label).toMatch(/^Projected funding shortfall: .* 2026-11-08 deadline$/);
  });

  it("evaluates a deadline on the last forecast Sunday and omits one on the Monday after", () => {
    const due = (d: string) => snap(100, { bills: [bill("b1", 500, d)] });
    expect(domino(due("2027-01-31"), [payBy("b1", 0)]).map((d) => d.weekStart)).toEqual([W[12]]);
    expect(domino(due("2027-01-30"), [payBy("b1", 1)]).map((d) => d.weekStart)).toEqual([W[12]]);
    expect(domino(due("2027-02-01"), [payBy("b1", 0)])).toEqual([]);
    expect(status(due("2027-02-01"), payBy("b1", 0))?.status).toBe("beyond_horizon");
    expect(status(due("2027-01-30"), payBy("b1", 2))?.status).toBe("beyond_horizon");
  });

  it("puts an already missed deadline in week zero; overdue bills can be funded on asOf + 1", () => {
    const overdue = snap(1_000_000, { bills: [bill("b1", 500, "2026-10-20")] });
    const out = domino(overdue, [payBy("b1", 5)]); // deadline 10-25, before asOf
    expect(out.map((d) => d.weekStart)).toEqual([W[0]]);
    expect(out[0]?.evidence[1]?.note).toMatch(/already past its 2026-10-25 deadline/);
    expect(funded(overdue)).toEqual({ b1: "2026-10-31" });
    expect(status(overdue, payBy("b1", 30))?.status).toBe("clear"); // deadline 11-19
  });

  it("treats a paid target as met and excludes paid bills from the queue", () => {
    const s = snap(0, { bills: [bill("b1", 500, "2026-11-03", { paid: "2026-10-25" })] });
    expect(funded(s)).toEqual({});
    expect(status(s, payBy("b1", 0))?.status).toBe("clear");
  });
});

describe("min_runway_months", () => {
  // Burn = 13-week net outflow / 3 months.
  const s = (cash: number, payroll = [run("p1", 30_000, "2026-11-06")]) => snap(cash, { payroll });

  it("compares runway exactly at the boundary, including fractional months", () => {
    // usable 970,000 / (30,000 / 3) = 97 months
    expect(domino(s(1_000_000), [runway(97)])).toEqual([]);
    expect(domino(s(1_000_000), [runway(97.5)]).map((d) => [d.weekStart, d.label])).toEqual([
      [W[0], "Runway falls under 97.5 months (Runway policy)"],
    ]);
    // usable 975,000 / 10,000 = 97.5 months
    expect(domino(s(1_005_000), [runway(97.5)])).toEqual([]);
    expect(domino(s(1_005_000), [runway(97.51)])).toHaveLength(1);
  });

  it("uses each week's usable cash and reports the first breach", () => {
    // Burn 10,000/month; usable 985,000 (98.5 months) in weeks 0-3, then 970,000 (97 months).
    const two = s(1_000_000, [run("p1", 15_000, "2026-11-06"), run("p2", 15_000, "2026-12-04")]);
    expect(domino(two, [runway(98)]).map((d) => d.weekStart)).toEqual([W[4]]);
  });

  it("never breaks with zero or negative net burn", () => {
    expect(domino(snap(100), [runway(1_000)])).toEqual([]);
    const gaining = snap(100, { invoices: [inv("i1", 50_000, "2026-11-10")] });
    expect(domino(gaining, [runway(1_000)])).toEqual([]);
  });
});

describe("contextual dominoes", () => {
  // Base usable: wk0 10,000; wk1 12,000 (+5,000 receipt, -3,000 payroll); wk3 9,000 (-3,000).
  // Delaying the receipt to 12-01 gives wk1 7,000, wk3 4,000, wk4 9,000.
  const s = snap(1_000_000, {
    invoices: [inv("i1", 500_000, "2026-11-10")],
    payroll: [run("p1", 300_000, "2026-11-13"), run("p2", 300_000, "2026-11-27")],
  });
  const hiring = { label: "Two planned hires pause", evidence: doc("board-policy.pdf#4") };
  const floor = minCash("con_floor", 500_000, { consequence: hiring });
  const delay: Change[] = [{ kind: "delay_invoice", invoiceId: "i1", days: 21 }];
  const i1 = { source: "stripe", ref: "i1", note: expect.any(String) };

  it("chains a delayed receipt, the cash drop, the breach and its evidenced consequence", () => {
    expect(domino(s, [floor], delay, { baseline: true })).toEqual([
      {
        order: 1,
        weekStart: W[1],
        label: "$5,000 payment from Cobalt moves from 2026-11-10 to 2026-12-01",
        evidence: [i1],
      },
      {
        order: 2,
        weekStart: W[1],
        label: "Usable cash drops from $10,000 to $7,000",
        causedBy: 1,
        evidence: [i1],
      },
      {
        order: 3,
        weekStart: W[3],
        label: "Usable cash falls to $4,000, below Cash floor of $5,000",
        constraintId: "con_floor",
        causedBy: 2,
        evidence: [doc("loan.pdf#7")],
      },
      { order: 4, weekStart: W[3], label: hiring.label, causedBy: 3, evidence: [hiring.evidence] },
    ]);
  });

  it("omits counterfactual causal links without a baseline", () => {
    const out = domino(s, [floor], delay);
    expect(out.map((d) => [d.order, d.causedBy])).toEqual([
      [1, undefined],
      [2, undefined],
      [3, undefined],
      [4, 3], // the consequence follows its own breach by the constraint's metadata
    ]);
  });

  it("never invents a consequence without metadata", () => {
    const out = domino(s, [minCash("con_floor", 500_000)], delay, { baseline: true });
    expect(out.map((d) => d.order)).toEqual([1, 2, 3]);
    expect(out.some((d) => /hire/i.test(d.label))).toBe(false);
  });

  it("chains a lost receipt the same way", () => {
    const lost: Change[] = [{ kind: "lose_invoice", invoiceId: "i1" }];
    const out = domino(s, [floor], lost, { baseline: true });
    expect(out[0]?.label).toBe(
      "$5,000 payment from Cobalt, expected 2026-11-10, drops out of this scenario",
    );
    expect(out.map((d) => [d.weekStart, d.constraintId, d.causedBy])).toEqual([
      [W[1], undefined, undefined],
      [W[1], undefined, 1],
      [W[3], "con_floor", 2],
      [W[3], undefined, 3],
    ]);
  });

  it("leaves no marker or causal claim for an overridden change", () => {
    const undone: Change[] = [...delay, { kind: "delay_invoice", invoiceId: "i1", days: -21 }];
    const repaid: Change[] = [
      ...delay,
      { kind: "discount_early_pay", invoiceId: "i1", percent: 0, payOn: "2026-11-10" },
    ];
    expect(domino(s, [floor], undone, { baseline: true })).toEqual([]);
    expect(domino(s, [floor], repaid, { baseline: true })).toEqual([]);
    // A breach that happens anyway (base wk3 9,000 < 9,500) gets no cause.
    const out = domino(s, [minCash("tight", 950_000)], undone, { baseline: true });
    expect(out.map((d) => [d.weekStart, d.constraintId, d.causedBy])).toEqual([
      [W[3], "tight", undefined],
    ]);
  });

  it("does not pick one cause when two changes explain the same drop", () => {
    const two = snap(1_000_000, {
      invoices: [inv("i1", 250_000, "2026-11-10"), inv("i2", 250_000, "2026-11-10")],
      payroll: s.payroll,
    });
    const both: Change[] = [...delay, { kind: "delay_invoice", invoiceId: "i2", days: 21 }];
    const out = domino(two, [minCash("con_floor", 500_000)], both, { baseline: true });
    expect(out.map((d) => [d.order, d.causedBy, d.evidence.map((e) => e.ref)])).toEqual([
      [1, undefined, ["i1"]],
      [2, undefined, ["i2"]],
      [3, undefined, ["i1", "i2"]],
      [4, 3, ["loan.pdf#7"]],
    ]);
  });

  it("maps overdue changes to week zero", () => {
    const overdue = snap(1_000_000, { invoices: [inv("i0", 1000, "2026-10-01")] });
    const out = domino(overdue, [], [{ kind: "lose_invoice", invoiceId: "i0" }]);
    expect(out.map((d) => d.weekStart)).toEqual([W[0]]);
  });
});

describe("Kestrel fixture", () => {
  const kestrel = fixtures.snapshot;
  const constraints: Constraint[] = [
    ...fixtures.constraints,
    {
      ...payBy("bill_agency_nov", 5, "con_agency"),
      consequence: { label: "Agency pauses work", evidence: doc("agency.pdf#1") },
    },
    payBy("bill_cloud_q1", 0, "con_cloud"),
  ];
  const changes: Change[] = [
    ...fixtures.risks[0]!.changes,
    { kind: "lose_invoice", invoiceId: "inv_nw_q4" },
  ];
  const baseline: Forecast = forecast(kestrel, fixtures.model, []);
  const scenario = forecast(kestrel, fixtures.model, changes);
  const context = { model: fixtures.model, changes, baseline };
  const validRefs = new Set([
    ...kestrel.invoices.map((r) => r.id),
    ...kestrel.bills.map((r) => r.id),
    ...kestrel.deals.map((r) => r.id),
    ...constraints.flatMap((c) => [
      c.evidence.ref,
      ...(c.consequence ? [c.consequence.evidence.ref] : []),
    ]),
  ]);

  it("returns valid, ordered, acyclic, evidenced dominoes without mutating inputs", () => {
    const copies = structuredClone([kestrel, constraints, context]);
    const out = dominoes(scenario, constraints, kestrel, context);
    expect([kestrel, constraints, context]).toEqual(copies);
    expect(out.length).toBeGreaterThan(0);
    out.forEach((d, i) => {
      expect(DominoSchema.parse(d)).toEqual(d);
      expect(d.order).toBe(i + 1);
      if (d.causedBy !== undefined) expect(d.causedBy).toBeLessThan(d.order);
      expect(W as readonly string[]).toContain(d.weekStart);
      for (const e of d.evidence) expect(validRefs.has(e.ref)).toBe(true);
    });
    const weeks = out.map((d) => d.weekStart);
    expect([...weeks].sort()).toEqual(weeks);
    const ids = out.flatMap((d) => (d.constraintId ? [d.constraintId] : []));
    expect(new Set(ids).size).toBe(ids.length);
    expect(dominoes(scenario, constraints, kestrel, context)).toEqual(out);
  });

  it("checks the lender's minimum without context", () => {
    const out = dominoes(baseline, [fixtures.constraints[0]!], kestrel);
    for (const d of out) expect(DominoSchema.parse(d)).toEqual(d);
  });
});
