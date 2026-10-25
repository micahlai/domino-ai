import { FindingSchema, type Snapshot } from "@domino/contracts";
import { fixtures } from "@domino/contracts/fixtures";
import { describe, expect, it } from "vitest";
import { auditSnapshot } from "./audit";
import { scheduledItems } from "./scheduled-items";

const AT = "2026-10-30T18:00:00Z";
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const base = (): Snapshot => clone(fixtures.snapshot);
const run = (snapshot: Snapshot, previous: Snapshot | null = null) =>
  auditSnapshot({ snapshot, previous, detectedAt: AT });
const kinds = (s: Snapshot, p: Snapshot | null = null) => run(s, p).map((f) => f.kind);

/** Four monthly software charges, so a new one has a usual amount to compare against. */
function withCardHistory(): Snapshot {
  const s = base();
  s.cardTxns = ["06", "07", "08", "09"].map((m, i) => ({
    id: `card_h${i}`,
    date: `2026-${m}-25`,
    amount: 420_000,
    merchant: "FIGMA",
    category: "Software",
  }));
  return s;
}

describe("auditSnapshot", () => {
  it("finds nothing in the clean fixture and every finding is contract-valid", () => {
    expect(run(base())).toEqual([]);
    const s = base();
    s.bills.push({ ...(s.bills[1] as Snapshot["bills"][number]), id: "bill_agency_nov_2" });
    for (const f of run(s)) expect(FindingSchema.safeParse(f).success).toBe(true);
  });

  it("flags the same bill recorded twice under two ids as a high duplicate", () => {
    const s = base();
    s.bills.push({ ...(s.bills[1] as Snapshot["bills"][number]), id: "bill_agency_nov_2" });
    const [f] = run(s);
    expect(f).toMatchObject({
      kind: "duplicate",
      severity: "high",
      refs: ["bill_agency_nov", "bill_agency_nov_2"],
      detectedAt: AT,
    });
  });

  it("flags a record whose original amount changed between versions as a conflict", () => {
    const previous = base();
    const s = base();
    (s.invoices[0] as Snapshot["invoices"][number]).amount += 100_000;
    expect(run(s, previous)).toMatchObject([
      { kind: "conflict", severity: "high", refs: ["inv_acme_2027"] },
    ]);
    expect(kinds(s, null)).toEqual([]);
  });

  it("flags a new charge far above its usual amount, but not old history", () => {
    const previous = withCardHistory();
    const s = withCardHistory();
    s.cardTxns.push({
      ...(s.cardTxns[0] as Snapshot["cardTxns"][number]),
      id: "card_new",
      date: "2026-10-29",
      amount: 5_040_000,
    });
    expect(run(s, previous)).toMatchObject([
      { kind: "unusual_amount", severity: "high", refs: ["card_new"] },
    ]);
    const medium = withCardHistory();
    medium.cardTxns.push({
      ...(medium.cardTxns[0] as Snapshot["cardTxns"][number]),
      id: "card_mid",
      date: "2026-10-29",
      amount: 1_260_000,
    });
    expect(run(medium, previous)[0]?.severity).toBe("medium");
    expect(run(withCardHistory(), previous)).toEqual([]);
  });

  it("ignores customer receipts of different sizes", () => {
    const previous = base();
    const s = base();
    for (let i = 0; i < 4; i++)
      s.bankTxns.push({
        id: `dep_${i}`,
        date: "2026-10-28",
        amount: 10_000 + i,
        description: "STRIPE PAYOUT",
        counterparty: "Stripe",
      });
    s.bankTxns.push({
      id: "dep_big",
      date: "2026-10-29",
      amount: 90_000_000,
      description: "STRIPE PAYOUT",
      counterparty: "Stripe",
    });
    expect(run(s, previous)).toEqual([]);
  });

  it("flags backdated arrivals and future-dated postings", () => {
    const previous = base();
    const s = base();
    s.bankTxns.push(
      {
        id: "late",
        date: "2026-09-01",
        amount: -50_000,
        description: "VENDOR",
        counterparty: "Ops",
      },
      {
        id: "future",
        date: "2026-11-15",
        amount: -50_000,
        description: "VENDOR",
        counterparty: "Ops",
      },
    );
    expect(run(s, previous).map((f) => [f.kind, f.severity, f.refs[0]])).toEqual([
      ["unusual_timing", "high", "future"],
      ["unusual_timing", "medium", "late"],
    ]);
  });

  it("flags a missing payroll run and a signed deal with no invoice", () => {
    const s = base();
    s.payroll = ["2026-09-11", "2026-09-25", "2026-10-09", "2026-11-06"].map((date, i) => ({
      id: `pay_${i}`,
      date,
      amount: 60_000_000,
    }));
    expect(run(s).map((f) => [f.kind, f.severity, f.refs[0]])).toEqual([
      ["missing_expected", "high", "pay_2"],
    ]);
    s.deals.push({ ...(s.deals[1] as Snapshot["deals"][number]), id: "deal_signed", signed: true });
    expect(run(s).at(-1)).toMatchObject({
      kind: "missing_expected",
      severity: "low",
      refs: ["deal_signed"],
    });
  });

  it("is deterministic and gives repeated detections the same ids", () => {
    const s = base();
    s.bills.push({ ...(s.bills[1] as Snapshot["bills"][number]), id: "bill_agency_nov_2" });
    expect(run(s)).toEqual(run(clone(s)));
    const ids = run(s).map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("scheduledItems", () => {
  it("schedules open invoices, unpaid bills and future payroll inside 13 weeks", () => {
    const items = scheduledItems(base());
    expect(items.map((i) => [i.id, i.kind, i.dueWeek, i.cents, i.status])).toEqual([
      ["sched_bill_rent_nov", "payable", "2026-11-02", -6_200_000, "expected"],
      ["sched_pay_1106", "payroll", "2026-11-02", -60_000_000, "confirmed"],
      ["sched_bill_agency_nov", "payable", "2026-11-09", -4_500_000, "expected"],
      ["sched_inv_cobalt_2027", "receivable", "2026-11-09", 9_600_000, "expected"],
      ["sched_pay_1120", "payroll", "2026-11-16", -60_000_000, "confirmed"],
      ["sched_inv_acme_2027", "receivable", "2026-11-23", 24_000_000, "expected"],
      ["sched_inv_bp_nov", "receivable", "2026-11-30", 3_600_000, "expected"],
      ["sched_inv_nw_q4", "receivable", "2026-11-30", 25_000_000, "expected"],
      ["sched_bill_cloud_q1", "payable", "2026-12-28", -21_000_000, "expected"],
    ]);
  });

  it("puts overdue open items in week 0 as at risk and drops items past week 12", () => {
    const s = base();
    (s.invoices[3] as Snapshot["invoices"][number]).due = "2026-10-01";
    (s.bills[0] as Snapshot["bills"][number]).due = "2027-06-01";
    const items = scheduledItems(s);
    expect(items.find((i) => i.sourceRef === "inv_cobalt_2027")).toMatchObject({
      dueWeek: "2026-11-02",
      status: "at_risk",
    });
    expect(items.some((i) => i.sourceRef === "bill_cloud_q1")).toBe(false);
  });
});
