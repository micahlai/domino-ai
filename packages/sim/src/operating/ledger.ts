import type { BankTxn, BillingPlan, Invoice, Snapshot } from "@domino/contracts";
import {
  addDays,
  addMonthsAnchored,
  keyedInt,
  lastForecastSunday,
  nextOccurrence,
} from "../create.ts";
import { mulDiv, sum } from "../drivers/basics.ts";
import type { OperatingSpec } from "./anchors.ts";
import { type Realism, realism } from "./realism.ts";
import type { CashFlowCategory, OperatingProvenance, OperatingScenarioId } from "./types.ts";

export interface Ledger {
  snapshot: Snapshot;
  postings: OperatingProvenance["cashFlowPostings"];
  recognition: OperatingProvenance["revenueRecognition"];
  invoiced: number;
  collections: number;
  payments: number;
}

/** Exact integer allocation. The final slice receives the rounding remainder. */
export function allocate(total: number, weights: readonly number[]): number[] {
  const weight = weights.reduce((s, n) => s + BigInt(n), 0n);
  let remaining = total;
  return weights.map((n, i) => {
    const value =
      i === weights.length - 1 ? remaining : Number((BigInt(total) * BigInt(n)) / weight);
    remaining -= value;
    return value;
  });
}

const prefix = (spec: OperatingSpec) => `synthetic/${spec.id}`;
const monthEnd = (start: string) => addDays(addMonthsAnchored(start, 1), -1);
const monthStart = (spec: OperatingSpec, index: number) =>
  addMonthsAnchored(spec.periodStart, index);
const customerId = (spec: OperatingSpec, i: number) =>
  `${prefix(spec)}/customer/${String(i + 1).padStart(2, "0")}`;
const beforeWeekend = (date: string): string => {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dow === 6 ? addDays(date, -1) : dow === 0 ? addDays(date, -2) : date;
};
const weightsFor = (seed: number, spec: OperatingSpec) => {
  const r = realism(spec.id, seed);
  if (!r)
    return Array.from({ length: 24 }, (_, i) => keyedInt(seed, `operating-customer-${i}`, 70, 130));
  // Company-keyed pools with one clearly largest customer (concentration).
  return Array.from({ length: 24 }, (_, i) =>
    i === r.big ? 260 : keyedInt(seed, `${spec.id}/customer-${i}`, 50, 140),
  );
};

/** Days after due a pool pays: chronic late payers, a few early payers, the rest near on time. */
function lagFor(r: Realism, seed: number, pool: number, key: string): number {
  if (pool === r.big) return keyedInt(seed, `${key}/big`, 4, 12);
  if (r.late.includes(pool)) return keyedInt(seed, `${key}/late`, r.lateDays[0], r.lateDays[1]);
  if (r.early.includes(pool)) return -keyedInt(seed, `${key}/early`, 2, 6);
  return keyedInt(seed, `${key}/ontime`, 0, 4);
}
const poolOf = (spec: OperatingSpec, customer: string) =>
  Number(customer.slice(`${prefix(spec)}/customer/`.length)) - 1;
/** Inside the reported period a receipt must land by period end, and never before issue. */
const clampPaid = (date: string, issued: string, last: string) =>
  date > last ? last : date < issued ? issued : date;

function post(ledger: Ledger, txn: BankTxn, category: CashFlowCategory, recordId?: string) {
  ledger.snapshot.bankTxns.push(txn);
  ledger.postings.push({
    bankTxnId: txn.id,
    date: txn.date,
    cents: txn.amount,
    category,
    ...(recordId && { recordId }),
    basis: "reconstructed",
  });
}

function collect(ledger: Ledger, invoice: Invoice, paid: string) {
  invoice.paid = paid;
  invoice.paidAmount = invoice.amount;
  post(
    ledger,
    {
      id: `${invoice.id}/bank`,
      date: paid,
      amount: invoice.amount,
      description: `Synthetic operating receipt for ${invoice.id}`,
      counterparty: invoice.customerId,
    },
    "operating",
    invoice.id,
  );
}

function historicalInvoices(ledger: Ledger, spec: OperatingSpec, seed: number) {
  const weights = weightsFor(seed, spec);
  const r = realism(spec.id, seed);
  const paidOn = (invoice: Invoice, legacy: number) =>
    r
      ? clampPaid(
          addDays(invoice.due, lagFor(r, seed, poolOf(spec, invoice.customerId), invoice.id)),
          invoice.issued,
          spec.periodEnd,
        )
      : addDays(invoice.due, legacy);
  for (const [i, amount] of allocate(spec.openingAR, weights).entries()) {
    const invoice = {
      id: `${prefix(spec)}/invoice/opening-${i}`,
      customerId: customerId(spec, i),
      amount,
      issued: addDays(spec.periodStart, -30),
      due: addDays(spec.periodStart, i % 20),
    };
    ledger.snapshot.invoices.push(invoice);
    collect(ledger, invoice, paidOn(invoice, keyedInt(seed, invoice.id, 0, 3)));
  }
  const monthlyPaid = allocate(ledger.invoiced - spec.closingAR, Array(spec.months).fill(1));
  for (const [m, paidTotal] of monthlyPaid.entries()) {
    for (const [i, amount] of allocate(paidTotal, weights).entries()) {
      const issued = addDays(monthStart(spec, m), i % 4);
      const invoice = {
        id: `${prefix(spec)}/invoice/history-${m}-${i}`,
        customerId: customerId(spec, i),
        amount,
        issued,
        due: addDays(issued, 15),
      };
      ledger.snapshot.invoices.push(invoice);
      collect(ledger, invoice, paidOn(invoice, keyedInt(seed, invoice.id, 0, 7)));
    }
  }
  for (const [i, amount] of allocate(spec.closingAR, weights).entries()) {
    // The largest customer's closing receivable is already long overdue (realistic books only).
    const issued =
      r && i === r.big ? addDays(spec.periodEnd, -80) : addDays(spec.periodEnd, -15 + (i % 10));
    ledger.snapshot.invoices.push({
      id: `${prefix(spec)}/invoice/closing-ar-${i}`,
      customerId: customerId(spec, i),
      amount,
      issued,
      due: addDays(issued, 30),
    });
  }
}

function recognition(spec: OperatingSpec): Ledger["recognition"] {
  const amounts =
    spec.months === 9
      ? [
          ...allocate(spec.revenue - spec.quarterRevenue, Array(6).fill(1)),
          ...allocate(spec.quarterRevenue, [1, 1, 1]),
        ]
      : allocate(spec.revenue, [1, 1, 1]);
  return amounts.map((cents, index) => ({
    id: `${prefix(spec)}/revenue/${index}`,
    date: monthEnd(monthStart(spec, index)),
    cents,
    basis: "reconstructed",
    description: "Synthetic monthly accrual revenue allocation; not an invoice or a receipt.",
  }));
}

const vendors = [
  "Cloud and hosting",
  "Teaching or support partners",
  "Campaign services",
  "Facilities",
  "Legal and accounting",
  "Software tools",
];

function monthPayments(
  ledger: Ledger,
  spec: OperatingSpec,
  start: string,
  total: number,
  observedThrough: string,
  horizon: string,
  texture?: { r: Realism; index: number; base: number },
) {
  const split = allocate(texture ? texture.base : total, [60, 35, 5]);
  const [, baseVendor, cardTotal] = split;
  // Realistic books: supplier and card cash stay at the base month; growth lands in payroll.
  const payrollTotal = texture ? total - baseVendor! - cardTotal! : split[0]!;
  let vendorTotal = baseVendor!;
  if (texture)
    vendorTotal = taxRemittance(ledger, spec, start, vendorTotal, observedThrough, texture.r);
  const runAmounts = allocate(payrollTotal, [1, 1]);
  const dates = [beforeWeekend(addDays(start, 14)), beforeWeekend(monthEnd(start))];
  for (const [i, date] of dates.entries()) {
    if (date > horizon) continue;
    const run = { id: `${prefix(spec)}/payroll/${start}/${i}`, date, amount: runAmounts[i]! };
    ledger.snapshot.payroll.push(run);
    if (date <= observedThrough)
      post(
        ledger,
        {
          id: `${run.id}/bank`,
          date,
          amount: -run.amount,
          description: `Synthetic payroll cash payment ${run.id}`,
          counterparty: "Synthetic payroll provider",
        },
        "operating",
        run.id,
      );
  }
  const vendorWeights = texture
    ? [
        Math.round(
          25_000 *
            ((10_000 + texture.r.cloudRiseBp) / 10_000) **
              Math.floor(texture.index / texture.r.cloudRiseEveryMonths),
        ),
        25_000,
        20_000,
        12_000,
        10_000,
        8_000,
      ]
    : [25, 25, 20, 12, 10, 8];
  for (const [i, amount] of allocate(vendorTotal, vendorWeights).entries()) {
    const due = addDays(start, 9 + i * 3);
    if (due > horizon) continue;
    const bill = {
      id: `${prefix(spec)}/bill/${start}/${i}`,
      vendor: `Synthetic ${vendors[i]}`,
      amount,
      due,
      critical: i < 2,
      ...(due <= observedThrough && { paid: due }),
    };
    ledger.snapshot.bills.push(bill);
    if (bill.paid)
      post(
        ledger,
        {
          id: `${bill.id}/bank`,
          date: bill.paid,
          amount: -amount,
          description: `Synthetic supplier payment ${bill.id}`,
          counterparty: bill.vendor,
        },
        "operating",
        bill.id,
      );
  }
  const date = addDays(start, 24);
  if (date > horizon) return;
  const cardId = `${prefix(spec)}/card/${start}`;
  if (date <= observedThrough) {
    ledger.snapshot.cardTxns.push({
      id: cardId,
      date,
      amount: cardTotal!,
      merchant: "Synthetic operating card program",
      category: "Reconstructed operating card spend",
    });
    post(
      ledger,
      {
        id: `${cardId}/bank`,
        date,
        amount: -cardTotal!,
        description: `Synthetic card settlement ${cardId}`,
        counterparty: "Synthetic card provider",
      },
      "operating",
      cardId,
    );
  } else {
    ledger.snapshot.bills.push({
      id: `${cardId}/statement`,
      vendor: "Synthetic operating card program",
      amount: cardTotal!,
      due: date,
      critical: false,
    });
  }
}

/**
 * Quarterly sales and use tax on the 20th of Jan, Apr, Jul and Oct, carved out of that month's
 * supplier cash so totals are unchanged. Only paid remittances are recorded: like real books,
 * the next one is not a bill until it is paid, which leaves it for the risk scan to find.
 */
function taxRemittance(
  ledger: Ledger,
  spec: OperatingSpec,
  start: string,
  vendorTotal: number,
  observedThrough: string,
  r: Realism,
): number {
  const month = Number(start.slice(5, 7));
  const due = `${start.slice(0, 8)}20`;
  if (month % 3 !== 1 || due > observedThrough || due < start) return vendorTotal;
  const amount = mulDiv(vendorTotal, r.taxBp, 10_000);
  const bill = {
    id: `${prefix(spec)}/bill/${start}/sales-tax`,
    vendor: "Synthetic state sales and use tax",
    amount,
    due,
    critical: true,
    paid: due,
  };
  ledger.snapshot.bills.push(bill);
  post(
    ledger,
    {
      id: `${bill.id}/bank`,
      date: due,
      amount: -amount,
      description: `Synthetic quarterly tax remittance ${bill.id}`,
      counterparty: bill.vendor,
    },
    "operating",
    bill.id,
  );
  return vendorTotal - amount;
}

/** Month m's share of cash costs when costs grow linearly (realistic books only). */
const growthWeight = (r: Realism, m: number) => 10_000 + r.payrollGrowthBp * m;

export function historicalLedger(spec: OperatingSpec, seed: number): Ledger {
  const invoiced =
    spec.revenue +
    spec.closingDeferred -
    spec.openingDeferred -
    (spec.deferredScopeAdjustment ?? 0);
  const collections = spec.openingAR + invoiced - spec.closingAR;
  const ledger: Ledger = {
    snapshot: {
      companyId: "",
      asOf: spec.periodEnd,
      cashOnHand: 0,
      restrictedCash: spec.restrictedCash,
      customers: Array.from({ length: 24 }, (_, i) => ({
        id: customerId(spec, i),
        name:
          realism(spec.id, seed)?.customers[i] ??
          `Synthetic ${spec.id === "2u" ? "education partner" : "customer cohort"} ${String(i + 1).padStart(2, "0")}`,
        paymentTermsDays: 15,
      })),
      invoices: [],
      bankTxns: [],
      bills: [],
      cardTxns: [],
      payroll: [],
      deals: [],
      billingPlans: [],
    },
    postings: [],
    recognition: recognition(spec),
    invoiced,
    collections,
    payments: collections - spec.ocf,
  };
  historicalInvoices(ledger, spec, seed);
  ledger.snapshot.deals = ledger.snapshot.invoices
    .filter((invoice) => invoice.id.includes(`/invoice/history-${spec.months - 1}-`))
    .map((invoice) => ({
      id: `${invoice.id}/deal`,
      customerId: invoice.customerId,
      amount: invoice.amount,
      stage: "won",
      signed: true,
      expectedClose: invoice.issued,
      invoiceId: invoice.id,
      kind: "renewal",
    }));
  const r = realism(spec.id, seed);
  const weights = Array.from({ length: spec.months }, (_, m) => (r ? growthWeight(r, m) : 1));
  const payments = allocate(ledger.payments, weights);
  const base = mulDiv(ledger.payments, 1, spec.months);
  for (let m = 0; m < spec.months; m++)
    monthPayments(
      ledger,
      spec,
      monthStart(spec, m),
      payments[m]!,
      spec.periodEnd,
      spec.periodEnd,
      r ? { r, index: m, base } : undefined,
    );
  if (spec.cashFlowComponents) {
    postCashComponents(ledger, spec);
    return ledger;
  }
  for (const [category, amount] of [
    ["investing", spec.icf],
    ["financing", spec.fcf],
    ["fx", spec.fx],
  ] as const) {
    for (const [m, cents] of allocate(amount, Array(spec.months).fill(1)).entries()) {
      post(
        ledger,
        {
          id: `${prefix(spec)}/${category}/${m}`,
          date: monthEnd(monthStart(spec, m)),
          amount: cents,
          description: `Synthetic allocation of reported period ${category} cash flow${category === "investing" ? ": acquisition and investment settlements" : category === "financing" ? ": equity and financing settlements" : ": exchange-rate reconciliation"}; not an actual transaction`,
        },
        category,
      );
    }
  }
  return ledger;
}

/** Disclosed investment/financing totals retain their own bank entries and named residual. */
function postCashComponents(ledger: Ledger, spec: OperatingSpec) {
  for (const component of spec.cashFlowComponents ?? []) {
    for (const [m, cents] of allocate(component.cents, Array(spec.months).fill(1)).entries()) {
      if (cents === 0) continue;
      post(
        ledger,
        {
          id: `${prefix(spec)}/${component.category}/${component.id}/${m}`,
          date: monthEnd(monthStart(spec, m)),
          amount: cents,
          description: `Synthetic date allocation: ${component.label}; not an actual transaction`,
        },
        component.category,
        component.anchorId,
      );
    }
  }
}

function futurePlans(
  spec: OperatingSpec,
  seed: number,
  scenario: OperatingScenarioId,
  today: string,
): BillingPlan[] {
  const monthlyAmounts = allocate(mulDiv(spec.quarterRevenue, 1, 3), weightsFor(seed, spec));
  return monthlyAmounts.map((monthly, i) => {
    const everyMonths = i < 12 ? 1 : i < 20 ? 3 : 12;
    const anchorDate = addDays(addMonthsAnchored(spec.periodStart, i % everyMonths), i % 24);
    return {
      id: `${prefix(spec)}/plan/${i}`,
      customerId: customerId(spec, i),
      amount: monthly * everyMonths,
      anchorDate,
      nextInvoiceDate: nextOccurrence(anchorDate, today, everyMonths),
      everyMonths,
      paymentTermsDays: 15 + (scenario === "late-payments" && i < 8 ? 21 : 0),
      ...(scenario === "customer-loss" && i < 8 && { endDate: spec.simulationAsOf }),
    };
  });
}

function futureInvoices(
  ledger: Ledger,
  spec: OperatingSpec,
  seed: number,
  scenario: OperatingScenarioId,
  today: string,
) {
  const r = realism(spec.id, seed);
  for (const invoice of ledger.snapshot.invoices.filter((i) => !i.paid)) {
    const i = ledger.snapshot.customers.findIndex((c) => c.id === invoice.customerId);
    if (r) {
      // The big overdue receivable is finally paid 100 days late; others follow their pool.
      const lag = i === r.big ? 100 : Math.max(0, lagFor(r, seed, i, invoice.id));
      const day = addDays(invoice.due, lag);
      if (day <= today)
        collect(ledger, invoice, day > spec.periodEnd ? day : addDays(spec.periodEnd, 1));
      continue;
    }
    const day = addDays(
      spec.periodEnd,
      1 +
        keyedInt(seed, invoice.id, 0, 40) +
        (scenario === "late-payments" && i < 8 && spec.simulationAsOf === spec.periodEnd ? 21 : 0),
    );
    if (day <= today) collect(ledger, invoice, day);
  }
  const plans = futurePlans(spec, seed, scenario, today);
  ledger.snapshot.billingPlans = plans;
  for (const plan of plans) {
    for (
      let issued = nextOccurrence(plan.anchorDate, spec.periodEnd, plan.everyMonths);
      issued <= today;
      issued = nextOccurrence(plan.anchorDate, issued, plan.everyMonths)
    ) {
      if (plan.endDate && issued > plan.endDate) break;
      const invoice = {
        id: `${plan.id}/invoice/${issued}`,
        customerId: plan.customerId,
        amount: plan.amount,
        issued,
        due: addDays(issued, issued <= spec.simulationAsOf ? 15 : plan.paymentTermsDays),
        billingPlanId: plan.id,
      };
      ledger.snapshot.invoices.push(invoice);
      const pool = ledger.snapshot.customers.findIndex((c) => c.id === plan.customerId);
      const lag = r
        ? pool === r.big &&
          issued > addDays(spec.simulationAsOf, -75) &&
          issued <= spec.simulationAsOf
          ? 95
          : lagFor(r, seed, pool, invoice.id)
        : keyedInt(seed, invoice.id, 0, 7);
      const paid = addDays(invoice.due, lag);
      if (paid <= today) collect(ledger, invoice, paid < issued ? issued : paid);
    }
  }
}

/** Annual premium invoiced ahead of the renewal date, after the observation cutoff. */
function insuranceRenewal(
  ledger: Ledger,
  spec: OperatingSpec,
  r: Realism,
  monthly: number,
  today: string,
  horizon: string,
) {
  const due = addDays(spec.simulationAsOf, r.insuranceDays);
  if (due > horizon) return;
  const vendorMonth = mulDiv(monthly, 35, 100);
  const bill = {
    id: `${prefix(spec)}/bill/insurance-renewal-${due.slice(0, 4)}`,
    vendor: "Synthetic commercial insurance annual premium",
    amount: mulDiv(vendorMonth, r.insuranceBp, 10_000),
    due,
    critical: true,
    ...(due <= today && { paid: due }),
  };
  ledger.snapshot.bills.push(bill);
  if (bill.paid)
    post(
      ledger,
      {
        id: `${bill.id}/bank`,
        date: due,
        amount: -bill.amount,
        description: `Synthetic insurance premium ${bill.id}`,
        counterparty: bill.vendor,
      },
      "operating",
      bill.id,
    );
}

/**
 * CRM pipeline for realistic books: closed expansion history (won deals link the paid invoice
 * that billed them) and open expansion deals sized to quarterly revenue. Dates anchor to the
 * simulation cutoff so advancing the clock never moves them. Not counted as cash until won.
 */
function pipeline(ledger: Ledger, spec: OperatingSpec, r: Realism) {
  const s = ledger.snapshot;
  const linked = new Set(s.deals.map((d) => d.invoiceId));
  for (let k = 0; k < r.won + r.lost; k++) {
    const pool = (k * 5 + 2) % 24;
    const customerId = s.customers[pool]!.id;
    const won = k < r.won;
    const invoice = won
      ? s.invoices.find((i) => i.customerId === customerId && i.paid && !linked.has(i.id))
      : undefined;
    if (won && !invoice) continue;
    if (invoice) linked.add(invoice.id);
    s.deals.push({
      id: `${prefix(spec)}/deal/expansion-closed-${k}`,
      customerId,
      amount: invoice?.amount ?? mulDiv(spec.quarterRevenue, 50, 10_000),
      stage: won ? "won" : "lost",
      expectedClose: invoice?.issued ?? addDays(spec.periodEnd, -20 * (k + 1)),
      signed: won,
      invoiceId: invoice?.id ?? null,
      kind: "expansion",
    });
  }
  for (const [k, deal] of r.pipeline.entries())
    s.deals.push({
      id: `${prefix(spec)}/deal/expansion-open-${k}`,
      customerId: s.customers[deal.pool]!.id,
      amount: mulDiv(spec.quarterRevenue, deal.bp, 10_000),
      stage: "open",
      expectedClose: addDays(spec.simulationAsOf, deal.days),
      signed: false,
      invoiceId: null,
      kind: "expansion",
    });
}

function futureCosts(
  ledger: Ledger,
  spec: OperatingSpec,
  seed: number,
  scenario: OperatingScenarioId,
  today: string,
) {
  const horizon = lastForecastSunday(today);
  const monthly = mulDiv(ledger.payments, 1, spec.months);
  const r = realism(spec.id, seed);
  const weightSum = r
    ? Array.from({ length: spec.months }, (_, m) => growthWeight(r, m)).reduce((x, y) => x + y, 0)
    : 1;
  let index = spec.months;
  for (
    let start = addDays(spec.periodEnd, 1);
    start <= horizon;
    start = addMonthsAnchored(start, 1), index++
  ) {
    if (!r) monthPayments(ledger, spec, start, monthly, today, horizon);
    else
      monthPayments(
        ledger,
        spec,
        start,
        mulDiv(ledger.payments, growthWeight(r, index), weightSum),
        today,
        horizon,
        { r, index, base: monthly },
      );
  }
  if (r) insuranceRenewal(ledger, spec, r, monthly, today, horizon);
  if (scenario === "unexpected-expense") {
    const due = addDays(spec.simulationAsOf, 35);
    const bill = {
      id: `${prefix(spec)}/bill/illustrative-emergency`,
      vendor: "Synthetic urgent remediation services",
      amount: mulDiv(monthly, 25, 100),
      due,
      critical: true,
      ...(due <= today && { paid: due }),
    };
    ledger.snapshot.bills.push(bill);
    if (bill.paid)
      post(
        ledger,
        {
          id: `${bill.id}/bank`,
          date: due,
          amount: -bill.amount,
          description: `Synthetic unexpected expense ${bill.id}`,
          counterparty: bill.vendor,
        },
        "operating",
        bill.id,
      );
  }
}

/** Cut only observations plus known plans/obligations. No private settlement dates escape. */
export function observableLedger(
  spec: OperatingSpec,
  seed: number,
  scenario: OperatingScenarioId,
  today: string,
): Ledger {
  const ledger = historicalLedger(spec, seed);
  futureInvoices(ledger, spec, seed, scenario, today);
  futureCosts(ledger, spec, seed, scenario, today);
  const r = realism(spec.id, seed);
  if (r) pipeline(ledger, spec, r);
  ledger.snapshot.asOf = today;
  ledger.snapshot.companyId = `operating/${spec.id}/${scenario}`;
  ledger.snapshot.cashOnHand = sum([
    spec.openingCash,
    ...ledger.snapshot.bankTxns.map((txn) => txn.amount),
  ]);
  ledger.snapshot.bankTxns.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return ledger;
}
