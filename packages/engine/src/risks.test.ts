import {
  type CompanyModel,
  type Constraint,
  RiskEventSchema,
  type Snapshot,
  SnapshotSchema,
} from "@domino/contracts";
import { fixtures } from "@domino/contracts/fixtures";
import { describe, expect, it } from "vitest";
import { forecast } from "./forecast";
import { compareRisks, pickDiverse, scanRisks } from "./risks";

/** One kind's risks only, so other generators firing on the same records do not interfere. */
const scanKind =
  (prefix: string) =>
  (...args: Parameters<typeof scanRisks>) =>
    scanRisks(...args).filter((r) => r.id.startsWith(prefix));

// asOf Friday 2026-10-30: week 0 starts Monday 2026-11-02; last forecast Sunday 2027-01-31.
const tiny: Snapshot = {
  companyId: "tiny",
  asOf: "2026-10-30",
  cashOnHand: 10_000_000,
  restrictedCash: 0,
  customers: [
    { id: "c1", name: "One Co", paymentTermsDays: 30 },
    { id: "c2", name: "Two Co", paymentTermsDays: 30 },
  ],
  invoices: [],
  bankTxns: [],
  bills: [],
  cardTxns: [],
  payroll: [],
  deals: [],
};
const model = (delays: CompanyModel["customerDelayDays"] = {}): CompanyModel => ({
  version: 1,
  customerDelayDays: delays,
  recurringSpend: [],
  rules: [],
});
const paid = (id: string, due: string, paidOn: string, customerId = "c1") => ({
  id,
  customerId,
  amount: 100,
  issued: "2026-01-01",
  due,
  paid: paidOn,
});
// A bill after the receipt makes the low point depend on when the receipt lands.
const bill = { id: "b1", vendor: "V", amount: 9_000_000, due: "2027-01-20", critical: false };
const open = {
  id: "open1",
  customerId: "c1",
  amount: 1_000_000,
  issued: "2026-10-01",
  due: "2026-11-10",
};

describe("scanRisks late payments", () => {
  const scan = scanKind("risk_late_");
  it("uses the share of observable paid invoices more than 14 days late", () => {
    const s: Snapshot = {
      ...tiny,
      invoices: [
        open,
        paid("p1", "2026-06-01", "2026-06-16"), // 15 days late: counts
        paid("p2", "2026-07-01", "2026-07-15"), // exactly 14: does not count
        paid("p3", "2026-08-01", "2026-08-01"),
        paid("p4", "2026-09-01", "2026-09-30"), // 29 days late: counts
        paid("p5", "2026-10-01", "2026-11-20"), // paid after asOf: not observable
      ],
      bills: [bill],
    };
    const m = model({ c1: { mean: 4.4, p90: 20.6, samples: 4 } });
    const [risk] = scan(s, m, []);
    expect(risk?.id).toBe("risk_late_open1");
    expect(risk?.probability).toBe(0.5); // 2 of 4
    // additional delay = round(p90) - round(mean) = 21 - 4 = 17, not mean + p90
    expect(risk?.changes).toEqual([{ kind: "delay_invoice", invoiceId: "open1", days: 17 }]);
    expect(risk?.evidence.map((e) => e.ref)).toEqual(
      expect.arrayContaining(["p1", "p2", "p3", "p4", "open1"]),
    );
    expect(risk?.evidence.map((e) => e.ref)).not.toContain("p5");
  });

  it("falls back to the labelled 0.1 assumption with fewer than three samples", () => {
    const s: Snapshot = {
      ...tiny,
      invoices: [
        open,
        paid("p1", "2026-06-01", "2026-07-30"),
        paid("p2", "2026-07-01", "2026-08-30"),
      ],
      bills: [bill],
    };
    const [risk] = scan(s, model({ c1: { mean: 0, p90: 10, samples: 2 } }), []);
    expect(risk?.probability).toBe(0.1);
    expect(risk?.evidence.some((e) => /assumption/i.test(e.note))).toBe(true);
  });

  it("omits candidates without a learned delay or with no effect", () => {
    const s: Snapshot = { ...tiny, invoices: [open], bills: [bill] };
    expect(scan(s, model(), [])).toEqual([]); // no p90 evidence
    expect(scan(s, model({ c1: { mean: 9, p90: 9.4, samples: 5 } }), [])).toEqual([]); // 0 days
    // Receipt already after the horizon: delaying it changes nothing.
    const late = { ...open, due: "2027-02-10" };
    expect(
      scan({ ...s, invoices: [late] }, model({ c1: { mean: 0, p90: 30, samples: 5 } }), []),
    ).toEqual([]);
  });

  describe("daily deadline rules (E4-r1)", () => {
    // Review E4-2340ff8 #1: weekly totals match, but the two-day delay funds b on 11-04, after 11-03.
    const s: Snapshot = {
      ...tiny,
      cashOnHand: 0,
      customers: [{ id: "c1", name: "One Co", paymentTermsDays: 30 }],
      invoices: [
        { id: "i", customerId: "c1", amount: 100, issued: "2026-10-01", due: "2026-11-02" },
      ],
      bills: [{ id: "b", vendor: "V", amount: 100, due: "2026-11-03", critical: false }],
    };
    const m = model({ c1: { mean: 0, p90: 2, samples: 0 } });
    const payB: Constraint = {
      id: "con_pay_b",
      label: "Pay b on time",
      kind: "pay_by_date",
      limit: 0,
      billId: "b",
      evidence: { source: "document", ref: "doc#1", note: "rule" },
    };

    it("keeps a risk that breaks a deadline even when weekly totals are equal", () => {
      SnapshotSchema.parse(s);
      const delayed = forecast(s, m, [{ kind: "delay_invoice", invoiceId: "i", days: 2 }]);
      expect(JSON.stringify(delayed.weeks)).toBe(JSON.stringify(forecast(s, m, []).weeks));
      const risks = scan(s, m, [payB]);
      expect(risks.map((r) => [r.id, r.impactLowPoint, r.probability])).toEqual([
        ["risk_late_i", 0, 0.1],
      ]);
      expect(risks[0]?.changes).toEqual([{ kind: "delay_invoice", invoiceId: "i", days: 2 }]);
      for (const r of risks) expect(RiskEventSchema.parse(r)).toEqual(r);
    });

    it("still omits a delay that leaves the deadline met", () => {
      const later = { ...s, bills: [{ ...s.bills[0]!, due: "2026-11-04" }] };
      expect(scan(later, m, [payB])).toEqual([]);
      expect(scan(s, m, [])).toEqual([]);
    });
  });

  it("computes impact through forecast", () => {
    const s: Snapshot = { ...tiny, invoices: [open], bills: [bill] };
    const m = model({ c1: { mean: 0, p90: 90, samples: 3 } });
    const [risk] = scan(s, m, []);
    // Base: +1,000,000 on 11-10, -9,000,000 on 01-20 → low 2,000,000. Delayed 90 days: past horizon → low 1,000,000.
    expect(forecast(s, m, []).lowPoint.usable).toBe(2_000_000);
    expect(risk?.impactLowPoint).toBe(1_000_000);
  });
});

describe("scanRisks renewals", () => {
  const scan = scanKind("risk_nonrenewal_");
  const renewalInvoice = {
    id: "inv_r",
    customerId: "c1",
    amount: 500_000,
    issued: "2026-10-01",
    due: "2026-11-20",
  };
  const expansionInvoice = {
    id: "inv_x",
    customerId: "c2",
    amount: 700_000,
    issued: "2026-10-01",
    due: "2026-11-20",
  };
  const base: Snapshot = {
    ...tiny,
    invoices: [renewalInvoice, expansionInvoice],
    bills: [bill],
    deals: [
      {
        id: "d_r",
        customerId: "c1",
        amount: 500_000,
        stage: "won",
        expectedClose: "2026-10-01",
        signed: true,
        invoiceId: "inv_r",
        kind: "renewal",
      },
      {
        id: "d_x",
        customerId: "c2",
        amount: 700_000,
        stage: "won",
        expectedClose: "2026-10-01",
        signed: true,
        invoiceId: "inv_x",
        kind: "expansion",
      },
      {
        id: "d_u",
        customerId: "c2",
        amount: 300_000,
        stage: "open",
        expectedClose: "2026-12-01",
        signed: false,
        invoiceId: null,
        kind: "renewal",
      },
    ],
  };

  it("needs an explicit renewal kind and a linked open invoice", () => {
    SnapshotSchema.parse(base);
    const risks = scan(base, model(), []);
    expect(risks.map((r) => r.id)).toEqual(["risk_nonrenewal_d_r"]);
    expect(risks[0]).toMatchObject({ probability: 0.25, impactLowPoint: 500_000 });
    expect(risks[0]?.changes).toEqual([{ kind: "lose_invoice", invoiceId: "inv_r" }]);
  });

  it("uses 0.5 for a won but unsigned renewal", () => {
    const s: Snapshot = {
      ...base,
      deals: base.deals.map((d) => (d.id === "d_r" ? { ...d, signed: false } : d)),
    };
    expect(scan(s, model(), [])[0]?.probability).toBe(0.5);
  });

  it("treats missing kind as unknown, not a renewal", () => {
    const s: Snapshot = {
      ...base,
      deals: base.deals.map((d) => {
        const { kind: _, ...rest } = d;
        return rest;
      }),
    };
    expect(scan(s, model(), [])).toEqual([]);
  });

  it("never treats Kestrel's Northwind expansion as a renewal", () => {
    const risks = scanRisks(fixtures.snapshot, fixtures.model, fixtures.constraints);
    expect(
      risks.some((r) =>
        r.changes.some((c) => c.kind === "lose_invoice" && c.invoiceId === "inv_nw_q4"),
      ),
    ).toBe(false);
    expect(risks.map((r) => r.id)).toContain("risk_nonrenewal_deal_acme_renewal");
    for (const r of risks) expect(RiskEventSchema.parse(r)).toEqual(r);
  });
});

describe("scanRisks spend spikes", () => {
  const scan = scanKind("risk_spend");
  // asOf Friday 10-30: last complete week ends Sunday 10-25. Recent 09-28..10-25; earlier 08-31..09-27.
  const card = (id: string, date: string, amount: number) => ({
    id,
    date,
    amount,
    merchant: "M",
    category: "Software",
  });
  const withCards = (cards: ReturnType<typeof card>[]): Snapshot => ({
    ...tiny,
    cardTxns: cards,
    bills: [bill],
  });

  it("adds a week-zero removal for growth strictly over 20%", () => {
    const s = withCards([
      card("e1", "2026-08-31", 1_000),
      card("r1", "2026-10-25", 1_201),
      card("x1", "2026-10-26", 50_000), // incomplete current week: ignored
      card("x0", "2026-08-30", 50_000), // before both windows
    ]);
    const [risk] = scan(s, model(), []);
    expect(risk).toMatchObject({ id: "risk_spend_spike", probability: 0.3, impactLowPoint: 201 });
    expect(risk?.changes).toEqual([
      { kind: "remove_cash", date: "2026-11-02", amount: 201, label: "Card spend spike" },
    ]);
    expect(risk?.evidence.filter((e) => e.source === "ramp").map((e) => e.ref)).toEqual([
      "e1",
      "r1",
    ]);
    expect(risk?.evidence.some((e) => /assumption/i.test(e.note))).toBe(true);
  });

  it("does not fire at exactly 20% or without positive earlier spend", () => {
    expect(
      scan(
        withCards([card("e1", "2026-09-27", 1_000), card("r1", "2026-09-28", 1_200)]),
        model(),
        [],
      ),
    ).toEqual([]);
    expect(scan(withCards([card("r1", "2026-10-01", 5_000)]), model(), [])).toEqual([]);
  });
});

describe("scanRisks ordering", () => {
  it("ranks by probability times impact within a kind and caps each kind at two", () => {
    const invoices = ["a", "b", "c", "d", "e", "f"].map((id, i) => ({
      id,
      customerId: "c1",
      amount: 100_000 * (i + 1),
      issued: "2026-10-01",
      due: "2026-11-10",
    }));
    const s: Snapshot = { ...tiny, invoices, bills: [bill] };
    const risks = scanRisks(s, model({ c1: { mean: 0, p90: 120, samples: 1 } }), []);
    expect(risks.filter((r) => r.id.startsWith("risk_late_")).map((r) => r.id)).toEqual([
      "risk_late_f",
      "risk_late_e",
    ]);
    expect(risks.length).toBeLessThanOrEqual(5);
  });

  it("compares expected impact exactly and breaks ties by ID", () => {
    const r = (id: string, probability: number, impactLowPoint: number) => ({
      id,
      label: id,
      probability,
      impactLowPoint,
      changes: [],
      evidence: [],
    });
    // 0.1 * 3 and 0.3 * 1 are equal exactly, though 0.1 * 3 !== 0.3 in floating point.
    const sorted = [r("z", 0.1, 3), r("a", 0.3, 1), r("m", 0.2, 2)].sort(compareRisks);
    expect(sorted.map((x) => x.id)).toEqual(["m", "a", "z"]);
  });
});

describe("scanRisks diversity", () => {
  const r = (id: string, probability: number, impactLowPoint: number) => ({
    id,
    label: id,
    probability,
    impactLowPoint,
    changes: [],
    evidence: [],
  });

  it("takes the top of each kind first, at most two per kind, upside last", () => {
    const picked = pickDiverse([
      r("risk_nonrenewal_a", 0.5, 1_000),
      r("risk_nonrenewal_b", 0.5, 900),
      r("risk_nonrenewal_c", 0.5, 800),
      r("risk_nonrenewal_d", 0.5, 700),
      r("risk_late_x", 0.1, 10),
      r("risk_payroll_growth", 0.1, 5),
      r("risk_upside_early_i", 0.5, -100),
      r("risk_upside_deal_d", 0.1, -100),
      r("risk_vendor_z", 0, 99_999), // zero chance: never shown
    ]);
    expect(picked.map((x) => x.id)).toEqual([
      "risk_nonrenewal_a",
      "risk_nonrenewal_b",
      "risk_late_x",
      "risk_payroll_growth",
      "risk_upside_early_i",
    ]);
  });

  it("fills by score once every kind has a slot", () => {
    const picked = pickDiverse([
      r("risk_late_a", 0.5, 100),
      r("risk_late_b", 0.5, 90),
      r("risk_late_c", 0.5, 80),
      r("risk_due_x", 0.1, 1),
    ]);
    expect(picked.map((x) => x.id)).toEqual(["risk_late_a", "risk_late_b", "risk_due_x"]);
  });
});

describe("scanRisks record-based kinds", () => {
  // Low cash so every outflow moves the low point.
  const base: Snapshot = { ...tiny, cashOnHand: 2_000_000 };
  const only = (s: Snapshot, prefix: string, m = model()) => {
    const risks = scanKind(prefix)(SnapshotSchema.parse(s), m, []);
    for (const x of risks) {
      expect(RiskEventSchema.parse(x)).toEqual(x);
      expect(x.label).not.toMatch(/\b(inv|bill|pay|po|deal)_?\w*\d/); // no raw ids
    }
    return risks;
  };

  it("vendor price rise uses the vendor's own largest rise and a Laplace chance", () => {
    const vb = (id: string, due: string, amount: number, paid?: string) => ({
      id,
      vendor: "Acme Cloud",
      amount,
      due,
      critical: false,
      ...(paid && { paid }),
    });
    const s: Snapshot = {
      ...base,
      bills: [
        vb("v1", "2026-08-01", 100_000, "2026-08-01"),
        vb("v2", "2026-09-01", 112_000, "2026-09-01"),
        vb("v3", "2026-10-01", 112_000, "2026-10-01"),
        vb("v4", "2026-11-01", 112_000),
      ],
    };
    const [risk] = only(s, "risk_vendor_");
    expect(risk).toMatchObject({ id: "risk_vendor_v4", probability: 2 / 5 }); // (1+1)/(3+2)
    expect(risk?.changes).toEqual([
      {
        kind: "remove_cash",
        date: "2026-11-01",
        amount: 13_440,
        label: "Acme Cloud price rise on v4",
      },
    ]);
    expect(risk?.label).toBe("Acme Cloud raises prices 12% (+$134 over 1 bills from Nov 1)");
    expect(risk?.impactLowPoint).toBe(13_440);
  });

  it("payroll growth repeats the recent hiring step and skips flat payroll", () => {
    const runs = [100, 100, 100, 110, 110, 120].map((k, i) => ({
      id: `pr${i}`,
      date: `2026-0${4 + i}-15`,
      amount: k * 1_000,
    }));
    const future = [{ id: "pf", date: "2026-11-13", amount: 120_000 }];
    const s: Snapshot = { ...base, payroll: [...runs, ...future] };
    const [risk] = only(s, "risk_payroll_");
    // Last three average 113,333, prior three 100,000: step floor(40,000 / 3) = 13,333.
    expect(risk?.changes).toEqual([
      { kind: "remove_cash", date: "2026-11-13", amount: 13_333, label: "Payroll growth on pf" },
    ]);
    expect(risk?.probability).toBe(2 / 5);
    const flat = { ...s, payroll: [...runs.map((p) => ({ ...p, amount: 100_000 })), ...future] };
    expect(only(flat, "risk_payroll_")).toEqual([]);
  });

  it("flags a tax payment due on its own cadence that is not booked yet", () => {
    const tax = (id: string, due: string) => ({
      id,
      vendor: "State sales tax",
      amount: 50_000,
      due,
      paid: due,
      critical: false,
    });
    const s: Snapshot = { ...base, bills: [tax("t1", "2026-07-20"), tax("t2", "2026-10-20")] };
    const [risk] = only(s, "risk_due_");
    expect(risk).toMatchObject({ id: "risk_due_t2", probability: 2 / 3 });
    expect(risk?.changes).toEqual([
      {
        kind: "remove_cash",
        date: "2027-01-20",
        amount: 50_000,
        label: "State sales tax 2027-01-20",
      },
    ]);
    const booked = {
      ...s,
      bills: [...s.bills, { ...tax("t3", "2027-01-20"), paid: undefined }],
    };
    expect(only(SnapshotSchema.parse(booked), "risk_due_").map((r) => r.id)).not.toContain(
      "risk_due_t2",
    );
  });

  it("concentration delays the top customer's open invoices by its worst observed lateness", () => {
    const s: Snapshot = {
      ...base,
      invoices: [
        { ...open, amount: 3_000_000 },
        paid("p1", "2026-06-01", "2026-06-21"), // 20 days late
        paid("p2", "2026-07-01", "2026-07-03"),
        paid("p3", "2026-08-01", "2026-08-01"),
      ],
      bills: [bill],
    };
    const [risk] = only(s, "risk_concentration_", model({ c1: { mean: 4, p90: 5, samples: 3 } }));
    expect(risk).toMatchObject({ id: "risk_concentration_c1", probability: 1 / 3 });
    expect(risk?.changes).toEqual([{ kind: "delay_invoice", invoiceId: "open1", days: 16 }]);
    expect(risk?.label).toContain("One Co");
  });

  it("an overdue invoice not carried by a renewal may never be collected", () => {
    const s: Snapshot = {
      ...base,
      invoices: [{ ...open, due: "2026-09-30" }],
    };
    const [risk] = only(s, "risk_overdue_");
    expect(risk).toMatchObject({ id: "risk_overdue_open1", probability: 30 / 120 });
    expect(risk?.changes).toEqual([{ kind: "lose_invoice", invoiceId: "open1" }]);
  });

  it("a pending payout lands a week late", () => {
    const s: Snapshot = {
      ...base,
      cashOnHand: 0,
      invoices: [{ ...paid("pi", "2026-10-20", "2026-10-28"), amount: 600_000 }],
      pendingPayouts: [
        { id: "po1", amount: 500_000, expectedArrival: "2026-11-03", invoiceIds: ["pi"] },
      ],
      bills: [{ id: "b", vendor: "V", amount: 500_000, due: "2026-11-05", critical: false }],
    };
    const [risk] = only(s, "risk_inflow_");
    expect(risk).toMatchObject({ id: "risk_inflow_late_po1", probability: 0.15 });
    expect(risk?.changes.map((c) => c.kind)).toEqual(["remove_cash", "add_cash"]);
    expect(risk?.impactLowPoint).toBe(500_000);
  });

  it("upside: early collection uses the customer's early-payment share", () => {
    const s: Snapshot = {
      ...base,
      invoices: [
        { ...open, due: "2027-01-20" },
        paid("p1", "2026-06-11", "2026-06-01"), // 10 early
        paid("p2", "2026-07-11", "2026-07-01"), // 10 early
        paid("p3", "2026-08-01", "2026-08-05"),
      ],
      bills: [{ ...bill, due: "2027-01-08" }],
    };
    const [risk] = only(s, "risk_upside_");
    expect(risk).toMatchObject({ id: "risk_upside_early_open1", probability: 2 / 3 });
    expect(risk?.changes).toEqual([{ kind: "delay_invoice", invoiceId: "open1", days: -10 }]);
    expect(risk?.label.startsWith("Upside:")).toBe(true);
    expect(risk?.impactLowPoint).toBe(-1_000_000); // lands in the low week instead of after it
    // Shown last, after the downside risks.
    const all = scanRisks(s, model(), []);
    expect(all[all.length - 1]?.id).toBe("risk_upside_early_open1");
  });

  it("upside: an open new-business deal closes at the historical win rate", () => {
    const d = (id: string, stage: "open" | "won" | "lost", amount = 100_000) => ({
      id,
      customerId: "c2",
      amount,
      stage,
      expectedClose: stage === "open" ? "2026-11-15" : "2026-05-01",
      signed: stage === "won",
      invoiceId: null,
      kind: "new_business" as const,
    });
    const s: Snapshot = {
      ...base,
      bills: [{ ...bill, amount: 3_000_000 }],
      deals: [d("dn", "open", 900_000), d("w1", "won"), d("w2", "won"), d("l1", "lost")],
    };
    const [risk] = only(s, "risk_upside_deal_");
    expect(risk).toMatchObject({ id: "risk_upside_deal_dn", probability: 2 / 3 });
    expect(risk?.changes).toEqual([
      { kind: "add_cash", date: "2026-12-15", amount: 900_000, label: "Deal dn" },
    ]);
  });
});

describe("scanRisks subject cap", () => {
  it("shows one customer at most twice while other risks remain", () => {
    const r = (id: string, impactLowPoint: number) => ({
      id,
      label: id,
      probability: 0.5,
      impactLowPoint,
      changes: [],
      evidence: [],
    });
    const subject = (x: { id: string }) => (x.id.endsWith("_big") ? "big" : x.id);
    const picked = pickDiverse(
      [
        r("risk_concentration_big", 100),
        r("risk_overdue_big", 90),
        r("risk_late_big", 80),
        r("risk_vendor_v", 1),
        r("risk_due_t", 2),
        r("risk_payroll_growth", 3),
      ],
      subject,
    );
    // The third "big" risk outscores the rest but yields its slot to another customer.
    expect(picked.map((x) => x.id)).toEqual([
      "risk_concentration_big",
      "risk_overdue_big",
      "risk_payroll_growth",
      "risk_due_t",
      "risk_vendor_v",
    ]);
  });
});
