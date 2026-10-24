import {
  type CompanyModel,
  RiskEventSchema,
  type Snapshot,
  SnapshotSchema,
} from "@domino/contracts";
import { fixtures } from "@domino/contracts/fixtures";
import { describe, expect, it } from "vitest";
import { forecast } from "./forecast";
import { compareRisks, scanRisks } from "./risks";

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
    const [risk] = scanRisks(s, m, []);
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
    const [risk] = scanRisks(s, model({ c1: { mean: 0, p90: 10, samples: 2 } }), []);
    expect(risk?.probability).toBe(0.1);
    expect(risk?.evidence.some((e) => /assumption/i.test(e.note))).toBe(true);
  });

  it("omits candidates without a learned delay or with no effect", () => {
    const s: Snapshot = { ...tiny, invoices: [open], bills: [bill] };
    expect(scanRisks(s, model(), [])).toEqual([]); // no p90 evidence
    expect(scanRisks(s, model({ c1: { mean: 9, p90: 9.4, samples: 5 } }), [])).toEqual([]); // 0 days
    // Receipt already after the horizon: delaying it changes nothing.
    const late = { ...open, due: "2027-02-10" };
    expect(
      scanRisks({ ...s, invoices: [late] }, model({ c1: { mean: 0, p90: 30, samples: 5 } }), []),
    ).toEqual([]);
  });

  it("computes impact through forecast", () => {
    const s: Snapshot = { ...tiny, invoices: [open], bills: [bill] };
    const m = model({ c1: { mean: 0, p90: 90, samples: 3 } });
    const [risk] = scanRisks(s, m, []);
    // Base: +1,000,000 on 11-10, -9,000,000 on 01-20 → low 2,000,000. Delayed 90 days: past horizon → low 1,000,000.
    expect(forecast(s, m, []).lowPoint.usable).toBe(2_000_000);
    expect(risk?.impactLowPoint).toBe(1_000_000);
  });
});

describe("scanRisks renewals", () => {
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
    const risks = scanRisks(base, model(), []);
    expect(risks.map((r) => r.id)).toEqual(["risk_nonrenewal_d_r"]);
    expect(risks[0]).toMatchObject({ probability: 0.25, impactLowPoint: 500_000 });
    expect(risks[0]?.changes).toEqual([{ kind: "lose_invoice", invoiceId: "inv_r" }]);
  });

  it("uses 0.5 for a won but unsigned renewal", () => {
    const s: Snapshot = {
      ...base,
      deals: base.deals.map((d) => (d.id === "d_r" ? { ...d, signed: false } : d)),
    };
    expect(scanRisks(s, model(), [])[0]?.probability).toBe(0.5);
  });

  it("treats missing kind as unknown, not a renewal", () => {
    const s: Snapshot = {
      ...base,
      deals: base.deals.map((d) => {
        const { kind: _, ...rest } = d;
        return rest;
      }),
    };
    expect(scanRisks(s, model(), [])).toEqual([]);
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
    const [risk] = scanRisks(s, model(), []);
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
      scanRisks(
        withCards([card("e1", "2026-09-27", 1_000), card("r1", "2026-09-28", 1_200)]),
        model(),
        [],
      ),
    ).toEqual([]);
    expect(scanRisks(withCards([card("r1", "2026-10-01", 5_000)]), model(), [])).toEqual([]);
  });
});

describe("scanRisks ordering", () => {
  it("ranks by probability times impact, then risk ID, and keeps at most five", () => {
    const invoices = ["a", "b", "c", "d", "e", "f"].map((id, i) => ({
      id,
      customerId: "c1",
      amount: 100_000 * (i + 1),
      issued: "2026-10-01",
      due: "2026-11-10",
    }));
    const s: Snapshot = { ...tiny, invoices, bills: [bill] };
    const risks = scanRisks(s, model({ c1: { mean: 0, p90: 120, samples: 1 } }), []);
    expect(risks.map((r) => r.id)).toEqual([
      "risk_late_f",
      "risk_late_e",
      "risk_late_d",
      "risk_late_c",
      "risk_late_b",
    ]);
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
