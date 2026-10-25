import { type Change, ChangeSchema, type WorldState, WorldStateSchema } from "@domino/contracts";
import {
  addDays,
  extendObligations,
  isRealDate,
  lastForecastSunday,
  netOfFees,
  nextOccurrence,
  planInvoice,
  scheduleCollection,
} from "./create.ts";

type Runtime = NonNullable<WorldState["runtime"]>;
type Snapshot = WorldState["snapshot"];
type Applied = Runtime["appliedEvents"][number];
interface Step {
  world: WorldState;
  runtime: Runtime;
  from: string;
  to: string;
  week: number;
}

const DAY_MS = 86_400_000;
/** lcm(28, 29, 30, 31): every month's daily payroll rate is an integer multiple of 1/LCM. */
const LCM = 377_580n;
const fail = (message: string): never => {
  throw new Error(`advanceWeek: ${message}`);
};
const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DAY_MS;
const daysInMonth = (date: string) => {
  const [year, month] = date.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
};
const latest = (...dates: string[]) => dates.reduce((a, b) => (b > a ? b : a));

/**
 * Every advance is exactly seven days, so a ledger event applied in week w took effect
 * on the day after that advance's old today.
 */
const effectiveDay = (step: Step, week: number) => addDays(step.from, 1 - 7 * (step.week - week));

function futureDate(step: Step, date: string, what: string, notBefore = ""): string {
  if (!isRealDate(date)) fail(`${what} ${date} is not a real calendar date`);
  if (date <= step.from) fail(`${what} ${date} is not after today ${step.from}`);
  if (date < notBefore) fail(`${what} ${date} is before issuance ${notBefore}`);
  return date;
}

function unique<T extends { id: string }>(records: T[], id: string, what: string): T {
  const matches = records.filter((record) => record.id === id);
  if (matches.length > 1) fail(`duplicate ${what} ${id}`);
  return matches[0] ?? fail(`unknown ${what} ${id}`);
}

/** Open invoice and its queue, or undefined for a terminal (paid/written-off) no-op. */
function openInvoice(step: Step, id: string) {
  const invoice = unique(step.world.snapshot.invoices, id, "invoice");
  if (invoice.paid || invoice.writtenOff) return undefined;
  const collection = step.runtime.collections.find((entry) => entry.invoiceId === id);
  if (!collection) return fail(`invoice ${id} has no scheduled collection`);
  return { invoice, collection };
}

function writeOff(step: Step, id: string, date: string) {
  const invoice = unique(step.world.snapshot.invoices, id, "invoice");
  invoice.writtenOff = date;
  invoice.collection = undefined;
  step.runtime.collections = step.runtime.collections.filter((entry) => entry.invoiceId !== id);
}

/** Decimal value of a percent as an exact fraction, from its shortest round-trip spelling. */
function exactFraction(value: number): [bigint, bigint] {
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(value));
  if (!match) return fail(`percent ${value} is not a finite nonnegative number`);
  const fraction = match[2] ?? "";
  const exponent = Number(match[3] ?? 0) - fraction.length;
  const digits = BigInt(match[1]! + fraction);
  return exponent >= 0
    ? [digits * 10n ** BigInt(exponent), 1n]
    : [digits, 10n ** BigInt(-exponent)];
}

/** gross * (100 - percent) / 100, rounded half up once on the remaining amount. */
function remainingAfter(gross: number, percent: number): number {
  const [n, d] = exactFraction(percent);
  const numerator = BigInt(gross) * (100n * d - n);
  const denominator = 100n * d;
  return Number((2n * numerator + denominator) / (2n * denominator));
}

function applyChange(step: Step, change: Change, ledgerId: string) {
  const { snapshot } = step.world;
  const effective = addDays(step.from, 1);
  switch (change.kind) {
    case "delay_invoice": {
      const open = openInvoice(step, change.invoiceId);
      if (!open) return;
      const { invoice, collection } = open;
      const payOn = addDays(collection.payOn, change.days);
      collection.payOn = futureDate(step, payOn, "delayed payment", invoice.issued);
      collection.payoutOn = addDays(collection.payoutOn, change.days);
      invoice.collection = { payOn: collection.payOn, amount: collection.grossAmount };
      return;
    }
    case "lose_invoice":
      if (openInvoice(step, change.invoiceId)) writeOff(step, change.invoiceId, effective);
      return;
    case "churn":
      unique(snapshot.customers, change.customerId, "customer");
      futureDate(step, change.fromDate, "churn date");
      return; // Kept in the ledger and applied on fromDate by churnOn.
    case "add_cash":
    case "remove_cash": {
      if (!Number.isSafeInteger(change.amount) || change.amount <= 0)
        fail(`${change.kind} amount must be positive safe cents`);
      step.runtime.cashEvents.push({
        id: `cash_${ledgerId}`,
        date: futureDate(step, change.date, "cash date"),
        amount: change.kind === "add_cash" ? change.amount : -change.amount,
        description: change.label,
      });
      return;
    }
    case "delay_bill": {
      const bill = unique(snapshot.bills, change.billId, "bill");
      if (bill.paid) return;
      if (bill.critical) fail(`bill ${bill.id} is critical and cannot be delayed`);
      const payment = step.runtime.billPayments.find((entry) => entry.billId === bill.id);
      if (!payment) return fail(`bill ${bill.id} has no scheduled payment`);
      payment.payOn = futureDate(step, addDays(payment.payOn, change.days), "delayed bill");
      bill.agreedPayOn = payment.payOn;
      return;
    }
    case "discount_early_pay": {
      const open = openInvoice(step, change.invoiceId);
      if (!open) return;
      const { invoice, collection } = open;
      const lag = daysBetween(collection.payOn, collection.payoutOn);
      collection.payOn = futureDate(step, change.payOn, "discount payment", invoice.issued);
      collection.payoutOn = addDays(collection.payOn, lag);
      // Chained discounts compound on the current agreed gross; the face amount never moves.
      collection.grossAmount = remainingAfter(collection.grossAmount, change.percent);
      collection.netAmount = netOfFees(collection.grossAmount);
      invoice.collection = { payOn: collection.payOn, amount: collection.grossAmount };
      return;
    }
    case "shift_hire":
      if (
        !isRealDate(change.fromDate) ||
        !isRealDate(change.toDate) ||
        change.toDate < change.fromDate
      )
        fail("shift_hire needs real fromDate on or before toDate");
      if (!Number.isSafeInteger(change.monthlyCost) || change.monthlyCost < 0)
        fail("shift_hire monthlyCost must be nonnegative safe cents");
      return; // Read from the ledger by payrollSaving.
  }
}

/**
 * Exact saving on one run: the 14-day accrual ending on the run date, intersected with each
 * shift's [fromDate, toDate) from its effective day, at monthlyCost / days in that month.
 * Summed as an exact fraction and rounded half up once.
 */
function payrollSaving(step: Step, events: Applied[], runDate: string): bigint {
  let numerator = 0n;
  for (const { week, change } of events) {
    if (change.kind !== "shift_hire") continue;
    const cost = BigInt(change.monthlyCost);
    const first = latest(addDays(runDate, -13), change.fromDate, effectiveDay(step, week));
    for (let day = first; day <= runDate && day < change.toDate; day = addDays(day, 1))
      numerator += cost * (LCM / BigInt(daysInMonth(day)));
  }
  return (2n * numerator + LCM) / (2n * LCM);
}

/** Baseline obligation per run: the published amount plus the savings already applied to it. */
function payrollBaselines(step: Step): Map<string, bigint> {
  const prior = step.runtime.appliedEvents;
  return new Map(
    step.world.snapshot.payroll.map((run) => [
      run.id,
      BigInt(run.amount) + payrollSaving(step, prior, run.date),
    ]),
  );
}

/** Publish every unposted run as baseline minus all ledger savings; reject excess savings. */
function publishPayroll(step: Step, baselines: Map<string, bigint>) {
  for (const run of step.world.snapshot.payroll) {
    if (run.date <= step.from) continue;
    const baseline = baselines.get(run.id) ?? BigInt(run.amount);
    const saving = payrollSaving(step, step.runtime.appliedEvents, run.date);
    if (saving > baseline) fail(`payroll saving ${saving} exceeds run ${run.id} of ${baseline}`);
    run.amount = Number(baseline - saving);
  }
}

/** Known obligations through the last Sunday of the 13 forecast weeks after the new cutoff. */
function scheduleObligations(step: Step, baselines: Map<string, bigint>) {
  const { snapshot } = step.world;
  const last = snapshot.payroll.reduce((a, b) => (b.date > a.date ? b : a));
  const baseline = baselines.get(last.id)!;
  if (baseline > BigInt(Number.MAX_SAFE_INTEGER)) fail(`payroll baseline ${baseline} is unsafe`);
  const added = extendObligations(
    snapshot,
    step.from,
    lastForecastSunday(step.to),
    Number(baseline),
  );
  for (const bill of added) step.runtime.billPayments.push({ billId: bill.id, payOn: bill.due });
}

/** Stale queues would backfill observations on or before the old cutoff: reject, never rewrite. */
function rejectStale(step: Step) {
  const { snapshot } = step.world;
  const stale = (date: string, what: string) => {
    if (date <= step.from) fail(`stale ${what} on ${date} is not after today ${step.from}`);
  };
  for (const entry of step.runtime.collections) {
    stale(entry.payOn, `collection ${entry.invoiceId}`);
    const invoice = unique(snapshot.invoices, entry.invoiceId, "invoice");
    if (invoice.paid || invoice.writtenOff)
      fail(`collection ${invoice.id} targets a settled invoice`);
    if (entry.payOn < invoice.issued) fail(`collection ${invoice.id} precedes issuance`);
  }
  for (const entry of step.runtime.billPayments) {
    stale(entry.payOn, `bill payment ${entry.billId}`);
    if (unique(snapshot.bills, entry.billId, "bill").paid)
      fail(`bill ${entry.billId} is already paid`);
  }
  for (const event of step.runtime.cashEvents) stale(event.date, `cash event ${event.id}`);
  for (const payout of snapshot.pendingPayouts ?? [])
    stale(payout.expectedArrival, `payout ${payout.id}`);
}

/** Churn on its fromDate: end plans and cancel unpaid collections scheduled from that day. */
function churnOn(step: Step, day: string) {
  const { snapshot } = step.world;
  for (const { change } of step.runtime.appliedEvents) {
    if (change.kind !== "churn" || change.fromDate !== day) continue;
    for (const entry of [...step.runtime.collections]) {
      const invoice = unique(snapshot.invoices, entry.invoiceId, "invoice");
      if (invoice.customerId === change.customerId && entry.payOn >= day)
        writeOff(step, invoice.id, day);
    }
    const lastDay = addDays(day, -1);
    for (const plan of snapshot.billingPlans ?? [])
      if (plan.customerId === change.customerId && !(plan.endDate && plan.endDate <= lastDay))
        plan.endDate = lastDay;
  }
}

/** Issue plan occurrences dated today; ended plans only move the cursor. */
function issueOn(step: Step, day: string) {
  for (const plan of step.world.snapshot.billingPlans ?? []) {
    while (plan.nextInvoiceDate <= day) {
      const issued = plan.nextInvoiceDate;
      if (!plan.endDate || issued <= plan.endDate) {
        const invoice = planInvoice(plan, issued);
        step.world.snapshot.invoices.push(invoice);
        step.runtime.collections.push(scheduleCollection(step.world.seed, invoice));
      }
      plan.nextInvoiceDate = nextOccurrence(plan.anchorDate, issued, plan.everyMonths);
    }
  }
}

function post(snapshot: Snapshot, txn: Snapshot["bankTxns"][number]) {
  if (snapshot.bankTxns.some((existing) => existing.id === txn.id))
    fail(`bank ${txn.id} posted twice`);
  snapshot.bankTxns.push(txn);
  snapshot.cashOnHand += txn.amount;
  if (!Number.isSafeInteger(snapshot.cashOnHand)) fail("cash left the safe integer range");
}

/** One day's observations, in policy order: churn, issuance, collection, then bank postings. */
function settleOn(step: Step, day: string) {
  const { snapshot } = step.world;
  const { runtime } = step;
  churnOn(step, day);
  issueOn(step, day);
  snapshot.pendingPayouts ??= [];
  const payouts = snapshot.pendingPayouts;
  for (const entry of runtime.collections.filter((c) => c.payOn === day)) {
    const invoice = unique(snapshot.invoices, entry.invoiceId, "invoice");
    invoice.paid = day;
    invoice.paidAmount = entry.grossAmount;
    payouts.push({
      id: `po_${invoice.id}`,
      amount: entry.netAmount,
      expectedArrival: entry.payoutOn,
      invoiceIds: [invoice.id],
    });
  }
  runtime.collections = runtime.collections.filter((c) => c.payOn !== day);
  for (const payout of payouts.filter((p) => p.expectedArrival === day))
    post(snapshot, {
      id: `bank_${payout.id}`,
      date: day,
      amount: payout.amount,
      description: `STRIPE PAYOUT ${payout.invoiceIds.join(" ")} NET FEES`,
      counterparty: "Stripe",
    });
  snapshot.pendingPayouts = payouts.filter((p) => p.expectedArrival !== day);
  for (const payment of runtime.billPayments.filter((p) => p.payOn === day)) {
    const bill = unique(snapshot.bills, payment.billId, "bill");
    bill.paid = day;
    post(snapshot, {
      id: `bank_${bill.id}`,
      date: day,
      amount: -bill.amount,
      description: `BILL ${bill.id}`,
      counterparty: bill.vendor,
    });
  }
  runtime.billPayments = runtime.billPayments.filter((p) => p.payOn !== day);
  for (const run of snapshot.payroll.filter((r) => r.date === day))
    post(snapshot, {
      id: `bank_${run.id}`,
      date: day,
      amount: -run.amount,
      description: `GUSTO PAYROLL ${run.id}`,
      counterparty: "Gusto",
    });
  if (day.endsWith("-25")) {
    const id = `card_${day}`;
    snapshot.cardTxns.push({
      id,
      date: day,
      amount: 3_800_000,
      merchant: "SOFTWARE VENDORS",
      category: "Software",
    });
    post(snapshot, {
      id: `bank_${id}`,
      date: day,
      amount: -3_800_000,
      description: `CARD SETTLEMENT ${id}`,
      counterparty: "Card issuer",
    });
  }
  for (const event of runtime.cashEvents.filter((e) => e.date === day))
    post(snapshot, { ...event });
  runtime.cashEvents = runtime.cashEvents.filter((e) => e.date !== day);
}

/**
 * Pure seven-day transition. Due pending events then injected changes take effect on
 * oldToday + 1 in order; then each day's observations are processed chronologically.
 */
export function advanceWeek(input: WorldState, injected: Change[]): WorldState {
  const world = WorldStateSchema.parse(structuredClone(input));
  const changes = ChangeSchema.array().parse(structuredClone(injected));
  const runtime = world.runtime;
  if (!runtime) return fail("legacy world has no runtime schedule; recreate it with createCompany");
  const step: Step = {
    world,
    runtime,
    from: world.today,
    to: addDays(world.today, 7),
    week: world.week + 1,
  };
  rejectStale(step);
  const baselines = payrollBaselines(step);
  const due = world.pendingEvents.filter((event) => event.week <= step.week);
  const applied = [
    ...due.map((event) => ({ id: event.id!, change: event.change })),
    ...changes.map((change, index) => ({ id: `inj_w${step.week}_${index}`, change })),
  ];
  for (const { id, change } of applied) {
    applyChange(step, change, id);
    runtime.appliedEvents.push({ id, week: step.week, change });
  }
  world.pendingEvents = world.pendingEvents.filter((event) => event.week > step.week);
  scheduleObligations(step, baselines);
  publishPayroll(step, baselines);
  for (let day = addDays(step.from, 1); day <= step.to; day = addDays(day, 1)) settleOn(step, day);
  const { snapshot } = world;
  snapshot.bankTxns.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  world.week = step.week;
  world.today = step.to;
  snapshot.asOf = step.to;
  return WorldStateSchema.parse(world);
}
