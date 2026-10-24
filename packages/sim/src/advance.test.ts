import { type Change, type WorldState, WorldStateSchema } from "@domino/contracts";
import { describe, expect, it } from "vitest";
import { addMonthsAnchored, nextOccurrence } from "./create";
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
    expect(world.runtime!.collections.map((c) => c.invoiceId).sort()).toEqual([
      "inv_acme_2027",
      "inv_bp_nov",
      "inv_cobalt_2027",
      "inv_nw_q4",
    ]);
    expect(world.runtime!.collections.every((c) => c.payOn > world.today)).toBe(true);
    expect(world.snapshot.pendingPayouts).toEqual([]);
    // cus_006: monthly, 30-day terms, last history invoice issued 2026-09-05.
    expect(plans.find((p) => p.customerId === "cus_006")).toMatchObject({
      anchorDate: "2026-09-05",
      nextInvoiceDate: "2026-11-05",
      everyMonths: 1,
      amount: invoice(world, "inv_cus_006_m6").amount,
    });
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
    // Ops 11-02 (35K), fixture rent 11-05 (62K), fixture payroll 11-06 (600K).
    expect(next.snapshot.cashOnHand).toBe(450_000_000 - 3_500_000 - 6_200_000 - 60_000_000);
    expect(bank(next, "bank_bill_rent_nov")).toHaveLength(1);
    expect(
      next.snapshot.bills.filter((b) => b.vendor === "Office landlord" && b.due === "2026-11-05"),
    ).toHaveLength(1);
    expect(invoice(next, "inv_nw_q4")).toMatchObject({
      writtenOff: "2026-11-06",
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
    expect(first.snapshot.pendingPayouts).toEqual([
      {
        id: "po_inv_cobalt_2027",
        amount: 9_321_600,
        expectedArrival: "2026-11-08",
        invoiceIds: ["inv_cobalt_2027"],
      },
    ]);
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
    // Hire shift: biweekly saving 6,000,000 on runs inside the window only, no deposits.
    expect(bank(world, "bank_pay_1106")[0]?.amount).toBe(-54_000_000);
    expect(bank(world, "bank_pay_1120")[0]?.amount).toBe(-54_000_000);
    expect(bank(world, "bank_pay_2026-12-04")[0]?.amount).toBe(-60_000_000);
    expect(world.snapshot.bankTxns.some((t) => t.counterparty === "Gusto" && t.amount > 0)).toBe(
      false,
    );
    // Churn: the outstanding plan invoice still collects; no issuance after the end date.
    const plan = world.snapshot.billingPlans!.find((p) => p.id === "plan_cus_006")!;
    expect(plan.endDate).toBe("2026-11-09");
    const cus010 = world.snapshot.invoices.filter((i) => i.billingPlanId === "plan_cus_006");
    expect(cus010.map((i) => i.issued)).toEqual(["2026-11-05"]);
    expect(cus010[0]?.paid).toBeDefined();
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
