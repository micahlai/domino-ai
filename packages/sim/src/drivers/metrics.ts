import type { Snapshot } from "@domino/contracts";
import { WINDOW_START, addDays, daysBetween, mulDiv, sum } from "./basics.ts";
import type { Timeline } from "./timeline.ts";

/**
 * Sanity metrics for a generated company, computed from the generated records (snapshot
 * receivables, bank flows, bills and payroll runs), not from the driver parameters, so a
 * test of these ranges checks the data itself. Ratios are basis points (integers).
 */
export interface CompanyMetrics {
  /** Recurring revenue in force on the cut date, annualized, cents */
  arr: number;
  /** Receivables / trailing 182-day billings x 182 (a half year smooths annual-billing lumps) */
  dsoDays: number;
  /**
   * Collection-period DSO: days from issue to cash, weighted by amount, over invoices paid in
   * the observed window. Stable under lumpy annual billing, unlike the receivables ratio.
   */
  collectionDays: number;
  /** Payroll / (payroll + suppliers + rent + card + taxes), from cash paid in the window */
  payrollShareBps: number;
  /** 1 - (hosting + monitoring + support/SRE payroll + card fees) / revenue, trailing 6 months */
  grossMarginBps: number;
  /** Net cash change per 30 days over the observed window, cents (negative = burn) */
  monthlyNetCash: number;
  headcount: number;
  usableCash: number;
  revolverDrawn: number;
}

export function companyMetrics(timeline: Timeline, snapshot: Snapshot): CompanyMetrics {
  const today = snapshot.asOf;
  const receivables = sum(
    snapshot.invoices.filter((i) => !i.paid && !i.writtenOff).map((i) => i.amount),
  );
  const fromHalf = addDays(today, -181);
  const billed = sum(
    snapshot.invoices.filter((i) => i.issued >= fromHalf && i.issued <= today).map((i) => i.amount),
  );
  const dsoDays = billed === 0 ? 0 : mulDiv(receivables, 182, billed);
  let weighted = 0n;
  let collected = 0;
  for (const i of snapshot.invoices) {
    if (!i.paid || i.paid < WINDOW_START) continue;
    const amount = i.paidAmount ?? i.amount;
    weighted += BigInt(amount) * BigInt(daysBetween(i.issued, i.paid));
    collected += amount;
  }
  const collectionDays =
    collected === 0 ? 0 : Number((weighted + BigInt(collected) / 2n) / BigInt(collected));

  const paidBills = timeline.bills.filter((b) => b.payOn >= WINDOW_START && b.payOn <= today);
  const billsOf = (...kinds: string[]) =>
    sum(paidBills.filter((b) => kinds.includes(b.kind)).map((b) => b.amount));
  const runs = timeline.roster.runs.filter((r) => r.date >= WINDOW_START && r.date <= today);
  const payroll = sum(runs.map((r) => r.amount));
  const opex =
    payroll +
    billsOf(
      "hosting",
      "cogs_software",
      "software",
      "contractor",
      "services",
      "marketing",
      "insurance",
      "recruiting",
      "rent",
      "card",
      "tax",
    );
  const payrollShareBps = mulDiv(payroll, 10_000, opex);

  // Revenue: recurring revenue in force each day of the trailing six months (ratable).
  const from = addDays(today, -182);
  let revenue = 0;
  for (let day = from; day <= today; day = addDays(day, 1))
    revenue += mulDiv(timeline.book.mrrOn(day), 12, 365);
  const inSpan = (date: string) => date >= from && date <= today;
  const cogsBills = sum(
    timeline.bills
      .filter((b) => (b.kind === "hosting" || b.kind === "cogs_software") && inSpan(b.received))
      .map((b) => b.amount),
  );
  const cogsPayroll = sum(
    timeline.roster.runs.filter((r) => inSpan(r.date)).map((r) => r.cogsCost),
  );
  const fees = sum(
    timeline.book.invoices
      .filter((i) => i.paidOn && inSpan(i.paidOn) && i.net !== undefined)
      .map((i) => i.amount - i.net!),
  );
  const grossMarginBps = 10_000 - mulDiv(cogsBills + cogsPayroll + fees, 10_000, revenue);

  const observedDays = daysBetween(WINDOW_START, today) + 1;
  return {
    arr: timeline.book.mrrOn(today) * 12,
    dsoDays,
    collectionDays,
    payrollShareBps,
    grossMarginBps,
    monthlyNetCash: mulDiv(snapshot.cashOnHand - timeline.openingCash, 30, observedDays),
    headcount: timeline.roster.headcountOn(today),
    usableCash: snapshot.cashOnHand - snapshot.restrictedCash,
    revolverDrawn: timeline.drawn.get(today) ?? 0,
  };
}

/** Lowest usable balance (bank close minus lease collateral) on days in [from, to]. */
export function lowestUsable(timeline: Timeline, from: string, to: string) {
  let low = { date: from, usable: Number.POSITIVE_INFINITY };
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const usable = (timeline.balances.get(day) ?? 0) - timeline.spec.restrictedCash;
    if (usable < low.usable) low = { date: day, usable };
  }
  return low;
}
