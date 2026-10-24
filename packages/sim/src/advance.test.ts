import { type Change, type WorldState, WorldStateSchema } from "@domino/contracts";
import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonthsAnchored,
  lastForecastSunday,
  netOfFees,
  nextOccurrence,
} from "./create";
import { simulator } from "./index";

const start = () => simulator.createCompany("kestrel", 42);
const advance = (world: WorldState, changes: Change[] = []) =>
  simulator.advanceWeek(world, changes);
const run = (world: WorldState, weeks: number, changes: Record<number, Change[]> = {}) => {
  let current = world;
  for (let i = 0; i < weeks; i++) current = advance(current, changes[current.week + 1] ?? []);
  return current;
};
const invoice = (world: WorldState, id: string) =>
  world.snapshot.invoices.find((i) => i.id === id)!;
const bank = (world: WorldState, id: string) => world.snapshot.bankTxns.filter((t) => t.id === id);
const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

describe("anchored cadence", () => {
  it("clamps month ends without moving the anchor, including leap years", () => {
    expect(addMonthsAnchored("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonthsAnchored("2027-01-31", 2)).toBe("2027-03-31");
    expect(addMonthsAnchored("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsAnchored("2026-11-30", 3)).toBe("2027-02-28");
    expect(nextOccurrence("2027-01-31", "2027-02-28", 1)).toBe("2027-03-31");
    expect(nextOccurrence("2024-02-29", "2024-02-29", 12)).toBe("2025-02-28");
    expect(nextOccurrence("2024-02-29", "2027-03-01", 12)).toBe("2028-02-29");
  });
});

describe("createCompany runtime", () => {
  it("keeps seeded history and adds IDs, queues and future-only plans", () => {
    const world = start();
    expect(WorldStateSchema.parse(world)).toEqual(world);
    expect(world.pendingEvents.map((e) => e.id)).toEqual(["evt_w26_0", "evt_w29_0"]);
    const plans = world.snapshot.billingPlans!;
    expect(plans).toHaveLength(296);
    expect(plans.every((p) => p.nextInvoiceDate > world.today)).toBe(true);
    const queued = world.runtime!.collections.map((c) => c.invoiceId);
    expect(queued).toEqual(
      expect.arrayContaining(["inv_acme_2027", "inv_bp_nov", "inv_cobalt_2027", "inv_nw_q4"]),
    );
    // Every other queue is a plan occurrence issued after its last history invoice.
    expect(queued.filter((id) => !invoice(world, id).billingPlanId)).toHaveLength(4);
    expect(world.runtime!.collections.every((c) => c.payOn > world.today)).toBe(true);
    expect(world.snapshot.pendingPayouts).toEqual([]);
    // cus_006: monthly, 30-day terms, last history invoice issued 2026-09-05.
    expect(plans.find((p) => p.customerId === "cus_006")).toMatchObject({
      anchorDate: "2026-09-05",
      nextInvoiceDate: "2026-11-05",
      everyMonths: 1,
      amount: invoice(world, "inv_cus_006_m6").amount,
    });
    // The Oct 5 occurrence is outstanding, not skipped; nothing after today is invented.
    expect(invoice(world, `inv_${JSON.stringify(["plan_cus_006", "2026-10-05"])}`)).toMatchObject({
      issued: "2026-10-05",
      due: "2026-11-04",
      billingPlanId: "plan_cus_006",
    });
    // One outstanding occurrence per monthly plan; annual plans have no gap.
    const linked = world.snapshot.invoices.filter((i) => i.billingPlanId);
    expect(linked).toHaveLength(plans.filter((p) => p.everyMonths === 1).length);
    expect(linked.every((i) => !i.paid && i.due > world.today)).toBe(true);
    expect(world.snapshot.invoices.every((i) => i.issued <= world.today)).toBe(true);
  });

  it("exposes known obligations through the last forecast Sunday at creation", () => {
    const { snapshot } = start();
    // First forecast Monday 2026-11-02, last Sunday 2027-01-31.
    expect(
      snapshot.payroll.filter((r) => r.date > "2026-10-30").map((r) => [r.date, r.amount]),
    ).toEqual([
      ["2026-11-06", 60_000_000],
      ["2026-11-20", 60_000_000],
      ["2026-12-04", 60_000_000],
      ["2026-12-18", 60_000_000],
      ["2027-01-01", 60_000_000],
      ["2027-01-15", 60_000_000],
      ["2027-01-29", 60_000_000],
    ]);
    const unpaid = snapshot.bills.filter((b) => !b.paid);
    expect(unpaid.filter((b) => b.vendor === "Operations vendors")).toHaveLength(13);
    expect(unpaid.filter((b) => b.vendor === "Office landlord").map((b) => b.due)).toEqual([
      "2026-11-05",
      "2026-12-05",
      "2027-01-05",
    ]);
    expect(unpaid.filter((b) => b.vendor === "Cloud provider").map((b) => b.id)).toEqual([
      "bill_cloud_q1",
    ]);
  });
});

describe("advanceWeek", () => {
  it("rejects a legacy world without runtime", () => {
    const { runtime: _, ...legacy } = start();
    expect(() => advance(legacy)).toThrow(/legacy world/);
  });

  it("is pure: frozen input, JSON round trip and retry give the same world", () => {
    const world = deepFreeze(start());
    const next = advance(world);
    expect(advance(JSON.parse(JSON.stringify(world)))).toEqual(next);
    expect(JSON.parse(JSON.stringify(next))).toEqual(JSON.parse(JSON.stringify(advance(world))));
    expect(world.week).toBe(25);
  });

  it("posts the hand-derived first week and applies the week-26 write-off", () => {
    const next = advance(start());
    expect([next.week, next.today, next.snapshot.asOf]).toEqual([26, "2026-11-06", "2026-11-06"]);
    // Ops 11-02 (35K), fixture rent 11-05 (62K), fixture payroll 11-06 (600K), plus the
    // net deposits of outstanding plan occurrences collected this week.
    const stripe = next.snapshot.bankTxns.filter(
      (t) => t.date > "2026-10-30" && t.counterparty === "Stripe",
    );
    expect(stripe.length).toBeGreaterThan(0);
    for (const t of stripe) {
      const paid = invoice(next, t.id.slice("bank_po_".length));
      expect(paid.billingPlanId).toBeDefined();
      expect(t.amount).toBe(paid.amount - Math.round((paid.amount * 29) / 1000));
    }
    expect(next.snapshot.cashOnHand).toBe(
      450_000_000 -
        3_500_000 -
        6_200_000 -
        60_000_000 +
        stripe.reduce((sum, t) => sum + t.amount, 0),
    );
    expect(bank(next, "bank_bill_rent_nov")).toHaveLength(1);
    expect(
      next.snapshot.bills.filter((b) => b.vendor === "Office landlord" && b.due === "2026-11-05"),
    ).toHaveLength(1);
    expect(invoice(next, "inv_nw_q4")).toMatchObject({
      writtenOff: "2026-10-31", // effective oldToday + 1
      amount: 25_000_000,
      due: "2026-11-30",
    });
    expect(next.runtime!.appliedEvents.map((e) => [e.id, e.week])).toEqual([["evt_w26_0", 26]]);
    expect(invoice(next, `inv_${JSON.stringify(["plan_cus_006", "2026-11-05"])}`)).toMatchObject({
      issued: "2026-11-05",
      due: "2026-12-05",
      billingPlanId: "plan_cus_006",
    });
  });

  it("runs thirteen schema-valid weeks with exact bank reconciliation and forward coverage", () => {
    let world = start();
    const opening =
      world.snapshot.cashOnHand - world.snapshot.bankTxns.reduce((s, t) => s + t.amount, 0);
    for (let i = 0; i < 13; i++) {
      const before = world;
      world = advance(world);
      const seen = new Set(before.snapshot.bankTxns.map((t) => t.id));
      const fresh = world.snapshot.bankTxns.filter((t) => !seen.has(t.id));
      expect(world.snapshot.cashOnHand).toBe(
        before.snapshot.cashOnHand + fresh.reduce((s, t) => s + t.amount, 0),
      );
      expect(fresh.every((t) => t.date > before.today && t.date <= world.today)).toBe(true);
      expect(new Set(world.snapshot.bankTxns.map((t) => t.id)).size).toBe(
        world.snapshot.bankTxns.length,
      );
      expect(world.snapshot.cardTxns.every((t) => t.date <= world.today)).toBe(true);
      expect(world.snapshot.invoices.every((inv) => !inv.paid || inv.paid <= world.today)).toBe(
        true,
      );
      expect(world.snapshot.billingPlans!.every((p) => p.nextInvoiceDate > world.today)).toBe(true);
      expect(world.snapshot.payroll.some((r) => r.date > world.today)).toBe(true);
      expect(world.snapshot.bills.some((b) => !b.paid)).toBe(true);
      expect(world.runtime!.collections.length).toBeGreaterThan(0);
      expect(WorldStateSchema.safeParse(world).success).toBe(true);
    }
    expect(world.week).toBe(38);
    expect(world.today).toBe("2027-01-29");
    expect(
      world.snapshot.cashOnHand - world.snapshot.bankTxns.reduce((s, t) => s + t.amount, 0),
    ).toBe(opening);
    expect(invoice(world, "inv_acme_2027").collection?.payOn).toBeDefined(); // week-29 delay published
    expect(invoice(world, "inv_acme_2027").due).toBe("2026-11-25");
  });

  it("keeps a collected payment pending until its bank deposit, once", () => {
    const world = start();
    const entry = world.runtime!.collections.find((c) => c.invoiceId === "inv_cobalt_2027")!;
    Object.assign(entry, { payOn: "2026-11-05", payoutOn: "2026-11-08" });
    const first = advance(world);
    expect(invoice(first, "inv_cobalt_2027")).toMatchObject({
      paid: "2026-11-05",
      paidAmount: 9_600_000,
    });
    expect(first.snapshot.pendingPayouts).toContainEqual({
      id: "po_inv_cobalt_2027",
      amount: 9_321_600,
      expectedArrival: "2026-11-08",
      invoiceIds: ["inv_cobalt_2027"],
    });
    expect(bank(first, "bank_po_inv_cobalt_2027")).toEqual([]);
    const third = run(first, 2);
    expect(bank(third, "bank_po_inv_cobalt_2027")).toEqual([
      expect.objectContaining({ date: "2026-11-08", amount: 9_321_600 }),
    ]);
    expect(third.snapshot.pendingPayouts).toEqual([]);
  });

  it("applies every change kind across several weeks", () => {
    const changes: Record<number, Change[]> = {
      26: [
        {
          kind: "discount_early_pay",
          invoiceId: "inv_cobalt_2027",
          percent: 2,
          payOn: "2026-11-03",
        },
        { kind: "delay_bill", billId: "bill_agency_nov", days: 10 },
        {
          kind: "shift_hire",
          label: "Defer hire",
          monthlyCost: 13_000_000,
          fromDate: "2026-11-01",
          toDate: "2026-11-30",
        },
      ],
      27: [
        { kind: "churn", customerId: "cus_006", fromDate: "2026-11-10" },
        { kind: "delay_invoice", invoiceId: "inv_bp_nov", days: 7 },
        { kind: "add_cash", date: "2026-11-12", amount: 1_000_000, label: "Grant" },
      ],
      28: [{ kind: "remove_cash", date: "2026-11-20", amount: 250_000, label: "Fee" }],
    };
    const world = run(start(), 13, changes);
    // Discount: face kept, gross 9,408,000, fee round(272,832) once.
    const cobalt = invoice(world, "inv_cobalt_2027");
    expect(cobalt).toMatchObject({
      amount: 9_600_000,
      due: "2026-11-14",
      paid: "2026-11-03",
      paidAmount: 9_408_000,
    });
    expect(bank(world, "bank_po_inv_cobalt_2027")[0]?.amount).toBe(9_135_168);
    // Delayed bill: original due, agreed date published, paid then.
    const agency = world.snapshot.bills.find((b) => b.id === "bill_agency_nov")!;
    expect(agency).toMatchObject({
      due: "2026-11-15",
      agreedPayOn: "2026-11-25",
      paid: "2026-11-25",
    });
    // Hire shift [Nov 1, Nov 30) at 13M/30 per day, accrued over each run's 14 days:
    // Nov 6 saves 6 days, Nov 20 saves 14 (6,066,666.67 rounded once), Dec 4 saves 9.
    expect(bank(world, "bank_pay_1106")[0]?.amount).toBe(-57_400_000);
    expect(bank(world, "bank_pay_1120")[0]?.amount).toBe(-53_933_333);
    expect(bank(world, "bank_pay_2026-12-04")[0]?.amount).toBe(-56_100_000);
    expect(bank(world, "bank_pay_2026-12-18")[0]?.amount).toBe(-60_000_000);
    expect(world.snapshot.bankTxns.some((t) => t.counterparty === "Gusto" && t.amount > 0)).toBe(
      false,
    );
    // Churn Nov 10: the Oct 5 occurrence collected Nov 5 is kept; the Nov 5 occurrence
    // (collection on or after Nov 10) is canceled on Nov 10; no issuance after the end date.
    const plan = world.snapshot.billingPlans!.find((p) => p.id === "plan_cus_006")!;
    expect(plan.endDate).toBe("2026-11-09");
    const cus006 = world.snapshot.invoices.filter((i) => i.billingPlanId === "plan_cus_006");
    expect(cus006.map((i) => [i.issued, i.paid, i.writtenOff])).toEqual([
      ["2026-10-05", "2026-11-05", undefined],
      ["2026-11-05", undefined, "2026-11-10"],
    ]);
    // Delay: due unchanged, agreed date published.
    const bp = invoice(world, "inv_bp_nov");
    expect(bp.due).toBe("2026-12-01");
    expect(bp.paid).toBe(bp.collection?.payOn);
    expect(bank(world, "cash_inj_w27_2")).toEqual([
      expect.objectContaining({ date: "2026-11-12", amount: 1_000_000 }),
    ]);
    expect(bank(world, "cash_inj_w28_0")).toEqual([
      expect.objectContaining({ date: "2026-11-20", amount: -250_000 }),
    ]);
    expect(invoice(world, "inv_nw_q4").paid).toBeUndefined();
    expect(world.runtime!.appliedEvents).toHaveLength(9);
  });

  it("posts identical cash in different weeks twice but a retry once", () => {
    const cash = (date: string): Change => ({
      kind: "add_cash",
      date,
      amount: 500_000,
      label: "Same",
    });
    const w26 = advance(start(), [cash("2026-11-20")]);
    const retry = advance(start(), [cash("2026-11-20")]);
    expect(retry).toEqual(w26);
    const w27 = advance(w26, [cash("2026-11-20")]);
    const w28 = advance(w27);
    expect(w28.snapshot.bankTxns.filter((t) => t.description === "Same").map((t) => t.id)).toEqual([
      "cash_inj_w26_0",
      "cash_inj_w27_0",
    ]);
  });

  it("fails atomically on unknown IDs, critical bills and retroactive dates", () => {
    const world = deepFreeze(start());
    const copy = JSON.stringify(world);
    const bad: Change[][] = [
      [{ kind: "lose_invoice", invoiceId: "inv_missing" }],
      [
        { kind: "add_cash", date: "2026-11-02", amount: 1, label: "ok" },
        { kind: "delay_bill", billId: "bill_rent_nov", days: 5 },
      ],
      [{ kind: "add_cash", date: "2026-10-30", amount: 1, label: "past" }],
      [{ kind: "delay_invoice", invoiceId: "inv_cobalt_2027", days: -60 }],
      [
        {
          kind: "discount_early_pay",
          invoiceId: "inv_cobalt_2027",
          percent: 2,
          payOn: "2026-02-30",
        },
      ],
      [{ kind: "churn", customerId: "cus_missing", fromDate: "2026-11-10" }],
    ];
    for (const changes of bad) expect(() => advance(world, changes)).toThrow(/advanceWeek/);
    expect(JSON.stringify(world)).toBe(copy);
  });
});

/** Kestrel with every record cleared except one 10,000-cent payroll run on Nov 6. */
const bare = (): WorldState => {
  const w = start();
  w.pendingEvents = [];
  Object.assign(w.snapshot, {
    invoices: [],
    deals: [],
    billingPlans: [],
    bills: [],
    cardTxns: [],
    bankTxns: [],
    payroll: [{ id: "pay_probe", date: "2026-11-06", amount: 10_000 }],
    cashOnHand: 100_000_000,
  });
  Object.assign(w.runtime!, {
    collections: [],
    billPayments: [],
    cashEvents: [],
    appliedEvents: [],
  });
  return w;
};
const owe = (w: WorldState, id: string, payOn: string, payoutOn: string, amount = 1000) => {
  w.snapshot.invoices.push({
    id,
    customerId: "cus_acme",
    amount,
    issued: "2026-10-01",
    due: "2026-10-30",
  });
  w.runtime!.collections.push({
    invoiceId: id,
    payOn,
    payoutOn,
    grossAmount: amount,
    netAmount: netOfFees(amount),
  });
};
const pay = (w: WorldState, date: string) =>
  w.snapshot.payroll.find((r) => r.date === date)?.amount;
const shift = (monthlyCost: number, fromDate: string, toDate: string): Change => ({
  kind: "shift_hire",
  label: "shift",
  monthlyCost,
  fromDate,
  toDate,
});

describe("E1b-r1 review probes", () => {
  it("churn cancels unpaid collections from fromDate, including earlier invoices, keeping collected", () => {
    const w = bare();
    owe(w, "pre", "2026-11-02", "2026-11-03");
    owe(w, "same", "2026-11-03", "2026-11-04");
    owe(w, "post", "2026-11-04", "2026-11-05");
    const next = advance(w, [{ kind: "churn", customerId: "cus_acme", fromDate: "2026-11-03" }]);
    expect(invoice(next, "pre")).toMatchObject({ paid: "2026-11-02", paidAmount: 1000 });
    expect(bank(next, "bank_po_pre")).toEqual([
      expect.objectContaining({ date: "2026-11-03", amount: 971 }),
    ]);
    expect(invoice(next, "same")).toMatchObject({ writtenOff: "2026-11-03" }); // churn before collection
    expect(invoice(next, "post")).toMatchObject({ writtenOff: "2026-11-03" });
    expect(next.runtime!.collections).toEqual([]);
  });

  it("keeps future churn private until fromDate, then applies it", () => {
    const w = bare();
    owe(w, "future", "2026-11-12", "2026-11-13");
    const first = advance(w, [{ kind: "churn", customerId: "cus_acme", fromDate: "2026-11-10" }]);
    expect(invoice(first, "future").writtenOff).toBeUndefined();
    expect(first.runtime!.collections.map((c) => c.invoiceId)).toEqual(["future"]);
    const second = advance(first);
    expect(invoice(second, "future")).toMatchObject({ writtenOff: "2026-11-10" });
    expect(invoice(second, "future").paid).toBeUndefined();
    expect(bank(second, "bank_po_future")).toEqual([]);
  });

  it("ends a churned plan at fromDate - 1 without publishing it early", () => {
    const w = start();
    const first = advance(w, [{ kind: "churn", customerId: "cus_011", fromDate: "2026-11-20" }]);
    expect(
      first.snapshot.billingPlans!.find((p) => p.customerId === "cus_011")!.endDate,
    ).toBeUndefined();
    const third = run(first, 2);
    expect(third.snapshot.billingPlans!.find((p) => p.customerId === "cus_011")!.endDate).toBe(
      "2026-11-19",
    );
  });

  it("dates a loss on its effective day and rejects retroactive churn", () => {
    const w = bare();
    owe(w, "lost", "2026-11-05", "2026-11-06");
    expect(
      invoice(advance(w, [{ kind: "lose_invoice", invoiceId: "lost" }]), "lost"),
    ).toMatchObject({
      writtenOff: "2026-10-31",
    });
    expect(() =>
      advance(w, [{ kind: "churn", customerId: "cus_acme", fromDate: "2026-10-30" }]),
    ).toThrow(/churn date/);
  });

  it("treats changes to paid or written-off invoices and paid bills as no-ops", () => {
    const w = bare();
    w.snapshot.invoices.push(
      {
        id: "paid",
        customerId: "cus_acme",
        amount: 1000,
        issued: "2026-10-01",
        due: "2026-10-20",
        paid: "2026-10-29",
      },
      {
        id: "gone",
        customerId: "cus_acme",
        amount: 1000,
        issued: "2026-10-01",
        due: "2026-10-20",
        writtenOff: "2026-10-29",
      },
    );
    w.snapshot.bills.push({
      id: "done",
      vendor: "V",
      amount: 5,
      due: "2026-10-29",
      paid: "2026-10-29",
      critical: false,
    });
    const plain = advance(w);
    const changed = advance(w, [
      { kind: "lose_invoice", invoiceId: "paid" },
      { kind: "delay_invoice", invoiceId: "gone", days: 3 },
      { kind: "discount_early_pay", invoiceId: "paid", percent: 10, payOn: "2026-11-02" },
      { kind: "delay_bill", billId: "done", days: 3 },
    ]);
    expect(changed.snapshot).toEqual(plain.snapshot);
    expect(changed.runtime!.appliedEvents).toHaveLength(4);
    expect(() => advance(w, [{ kind: "delay_bill", billId: "nope", days: 1 }])).toThrow(
      /unknown bill/,
    );
  });

  it("accrues payroll savings over the 14 days ending on the run, rounding once", () => {
    // [Nov 1, Nov 15) at 3000/30 per day: the Nov 6 run accrues Nov 1..6 = 600.
    const next = advance(bare(), [shift(3000, "2026-11-01", "2026-11-15")]);
    expect(bank(next, "bank_pay_probe")[0]?.amount).toBe(-9400);
    expect(pay(next, "2026-11-20")).toBe(10_000 - 800); // Nov 7..14
  });

  it("publishes reduced future payroll immediately", () => {
    // Nov 20 run accrues Nov 7..20; the shift covers Nov 16..20 = 5 days at 100.
    expect(pay(advance(bare(), [shift(3000, "2026-11-16", "2026-12-16")]), "2026-11-20")).toBe(
      9500,
    );
  });

  it("rejects payroll savings above the run instead of capping, atomically", () => {
    const w = deepFreeze(bare());
    const copy = JSON.stringify(w);
    expect(() => advance(w, [shift(1_000_000_000, "2026-11-01", "2026-11-15")])).toThrow(
      /exceeds run/,
    );
    expect(JSON.stringify(w)).toBe(copy);
  });

  it("never compounds savings across repeated advances and sums overlapping shifts", () => {
    let w = advance(bare(), [shift(3000, "2026-11-01", "2026-12-01")]);
    expect(pay(w, "2026-11-20")).toBe(10_000 - 1400); // Nov 7..20 at 100
    // Week 27 takes effect Nov 7: [Nov 10, Nov 25) at 6000/30 adds Nov 10..20 = 2200.
    w = advance(w, [shift(6000, "2026-11-10", "2026-11-25")]);
    expect(pay(w, "2026-11-20")).toBe(10_000 - 1400 - 2200);
    w = run(w, 3);
    expect(bank(w, "bank_pay_2026-11-20")[0]?.amount).toBe(-6400);
    // Dec 4 accrues Nov 21..Dec 4: 10 days at 100 and Nov 21..24 at 200.
    expect(bank(w, "bank_pay_2026-12-04")[0]?.amount).toBe(-(10_000 - 1000 - 800));
    expect(pay(w, "2026-12-18")).toBe(10_000);
    expect(
      w.snapshot.payroll.filter((r) => r.date > w.today).every((r) => r.amount === 10_000),
    ).toBe(true);
  });

  it("clamps a backdated shift to its effective day", () => {
    const first = advance(bare());
    // Applied in week 27, effective Nov 7: Nov 1..6 already posted at full cost.
    const next = advance(first, [shift(3000, "2026-11-01", "2026-11-15")]);
    expect(bank(next, "bank_pay_probe")[0]?.amount).toBe(-10_000);
    expect(pay(next, "2026-11-20")).toBe(10_000 - 800); // Nov 7..14
  });

  it("applies all effects to newly generated runs at each month's daily rate", () => {
    // Jan rate 3100/31 = 100; Feb 2027 rate 3100/28. Feb 12 accrues Jan 30..Feb 12.
    const w = run(advance(bare(), [shift(3100, "2027-01-01", "2027-03-01")]), 15);
    expect(bank(w, "bank_pay_2027-01-29")[0]?.amount).toBe(-(10_000 - 1400));
    expect(bank(w, "bank_pay_2027-02-12")[0]?.amount).toBe(-(10_000 - 1529)); // 200 + 1328.57
  });

  it("discounts the remaining amount exactly, chained, rounding half up", () => {
    const penny = bare();
    owe(penny, "penny", "2026-11-03", "2026-11-04", 1);
    const p = advance(penny, [
      { kind: "discount_early_pay", invoiceId: "penny", percent: 50, payOn: "2026-11-02" },
    ]);
    expect(invoice(p, "penny")).toMatchObject({ amount: 1, paid: "2026-11-02", paidAmount: 1 });
    const twice = bare();
    owe(twice, "d", "2026-11-04", "2026-11-05", 10_000);
    const t = advance(twice, [
      { kind: "discount_early_pay", invoiceId: "d", percent: 10, payOn: "2026-11-02" },
      { kind: "discount_early_pay", invoiceId: "d", percent: 10, payOn: "2026-11-03" },
    ]);
    expect(invoice(t, "d")).toMatchObject({ amount: 10_000, paid: "2026-11-03", paidAmount: 8100 });
    expect(bank(t, "bank_po_d")[0]?.amount).toBe(8100 - 235); // 234.9 rounded once
    const decimal = bare();
    owe(decimal, "x", "2026-11-04", "2026-11-05", 333);
    const x = advance(decimal, [
      { kind: "discount_early_pay", invoiceId: "x", percent: 2.5, payOn: "2026-11-02" },
    ]);
    expect(invoice(x, "x").paidAmount).toBe(325); // 324.675 half up
  });

  it("computes the 2.9% fee exactly near the safe integer limit", () => {
    expect(netOfFees(9_007_199_254_740_948)).toBe(8_745_990_476_353_461);
    expect(netOfFees(Number.MAX_SAFE_INTEGER)).toBe(8_745_990_476_353_502);
    for (const gross of [0, 1, 17, 500, 9_600_000, 9_408_000])
      expect(netOfFees(gross)).toBe(gross - Math.round((gross * 29) / 1000));
  });

  it("rejects stale queues and unsafe cash atomically instead of backfilling", () => {
    const stale = bare();
    owe(stale, "old", "2026-10-29", "2026-10-30");
    expect(WorldStateSchema.safeParse(stale).success).toBe(true);
    expect(() => advance(stale)).toThrow(/stale collection/);
    const payout = bare();
    payout.snapshot.invoices.push({
      id: "p",
      customerId: "cus_acme",
      amount: 1000,
      issued: "2026-10-01",
      due: "2026-10-20",
      paid: "2026-10-28",
    });
    payout.snapshot.pendingPayouts = [
      { id: "po_p", amount: 971, expectedArrival: "2026-10-30", invoiceIds: ["p"] },
    ];
    expect(() => advance(payout)).toThrow(/stale payout/);
    const big = bare();
    big.snapshot.cashOnHand = Number.MAX_SAFE_INTEGER - 100_000;
    deepFreeze(big);
    const copy = JSON.stringify(big);
    // Nov 2 pays 3.5M of operations, then the 20M deposit leaves the safe range.
    expect(() =>
      advance(big, [{ kind: "add_cash", date: "2026-11-02", amount: 20_000_000, label: "big" }]),
    ).toThrow(/safe integer/);
    expect(JSON.stringify(big)).toBe(copy);
  });

  it("keeps known obligations through the rolling 13-week horizon for 13 advances", () => {
    let world = start();
    for (let i = 0; i < 13; i++) {
      world = advance(world);
      const horizon = lastForecastSunday(world.today);
      const unpaid = world.snapshot.bills.filter((b) => !b.paid);
      for (let monday = addDays(world.today, 1); monday <= horizon; monday = addDays(monday, 1)) {
        if (new Date(`${monday}T00:00:00Z`).getUTCDay() === 1)
          expect(
            unpaid.some((b) => b.vendor === "Operations vendors" && b.due === monday),
            monday,
          ).toBe(true);
        if (monday.endsWith("-05"))
          expect(
            unpaid.some((b) => b.vendor === "Office landlord" && b.due === monday),
            monday,
          ).toBe(true);
      }
      const runs = world.snapshot.payroll.filter((r) => r.date > world.today);
      expect(addDays(runs.at(-1)!.date, 14) > horizon).toBe(true);
      expect(runs.every((r) => r.amount === 60_000_000)).toBe(true);
    }
    expect([world.today, lastForecastSunday(world.today)]).toEqual(["2027-01-29", "2027-05-02"]);
    expect(
      world.snapshot.bills.filter((b) => b.vendor === "Cloud provider").map((b) => b.due),
    ).toEqual(["2026-06-30", "2026-09-30", "2027-01-01", "2027-04-01"]);
    expect(world.snapshot.cardTxns.every((t) => t.date <= world.today)).toBe(true);
  });
});
