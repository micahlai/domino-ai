import { type Change, ChangeSchema, type WorldState, WorldStateSchema } from "@domino/contracts";
import { addDays, isRealDate, netOfFees, nextOccurrence, scheduleCollection } from "./create.ts";

type Runtime = NonNullable<WorldState["runtime"]>;
interface Step {
  world: WorldState;
  runtime: Runtime;
  from: string;
  to: string;
  week: number;
}

const OPS_ANCHOR = "2026-05-04";
const RENT_ANCHOR = "2026-11-05";
const fail = (message: string): never => {
  throw new Error(`advanceWeek: ${message}`);
};

function futureDate(step: Step, date: string, what: string): string {
  if (!isRealDate(date)) fail(`${what} ${date} is not a real calendar date`);
  if (date <= step.from) fail(`${what} ${date} is not after today ${step.from}`);
  return date;
}

function openInvoice(step: Step, id: string) {
  const invoice = step.world.snapshot.invoices.find((record) => record.id === id);
  if (!invoice) return fail(`unknown invoice ${id}`);
  if (invoice.paid || invoice.writtenOff) fail(`invoice ${id} is already settled`);
  const collection = step.runtime.collections.find((entry) => entry.invoiceId === id);
  if (!collection) return fail(`invoice ${id} has no scheduled collection`);
  return { invoice, collection };
}

function writeOff(step: Step, id: string) {
  const invoice = step.world.snapshot.invoices.find((record) => record.id === id)!;
  invoice.writtenOff = step.to;
  invoice.collection = undefined;
  step.runtime.collections = step.runtime.collections.filter((entry) => entry.invoiceId !== id);
}

function applyChange(step: Step, change: Change, ledgerId: string) {
  const { snapshot } = step.world;
  switch (change.kind) {
    case "delay_invoice": {
      const { invoice, collection } = openInvoice(step, change.invoiceId);
      collection.payOn = futureDate(
        step,
        addDays(collection.payOn, change.days),
        "delayed payment",
      );
      collection.payoutOn = addDays(collection.payoutOn, change.days);
      invoice.collection = { payOn: collection.payOn, amount: collection.grossAmount };
      return;
    }
    case "lose_invoice":
      openInvoice(step, change.invoiceId);
      return writeOff(step, change.invoiceId);
    case "churn": {
      if (!snapshot.customers.some((customer) => customer.id === change.customerId))
        fail(`unknown customer ${change.customerId}`);
      if (!isRealDate(change.fromDate)) fail(`churn date ${change.fromDate} is not real`);
      // Invoiced service stays owed; only invoices issued on or after churn are canceled.
      for (const invoice of snapshot.invoices)
        if (
          invoice.customerId === change.customerId &&
          !invoice.paid &&
          !invoice.writtenOff &&
          invoice.issued >= change.fromDate
        )
          writeOff(step, invoice.id);
      const lastDay = addDays(change.fromDate, -1);
      for (const plan of snapshot.billingPlans ?? [])
        if (plan.customerId === change.customerId && !(plan.endDate && plan.endDate <= lastDay))
          plan.endDate = lastDay;
      return;
    }
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
      const bill = snapshot.bills.find((record) => record.id === change.billId);
      if (!bill) return fail(`unknown bill ${change.billId}`);
      if (bill.critical) fail(`bill ${bill.id} is critical and cannot be delayed`);
      const payment = step.runtime.billPayments.find((entry) => entry.billId === bill.id);
      if (bill.paid || !payment) return fail(`bill ${bill.id} is already paid`);
      payment.payOn = futureDate(step, addDays(payment.payOn, change.days), "delayed bill");
      bill.agreedPayOn = payment.payOn;
      return;
    }
    case "discount_early_pay": {
      const { invoice, collection } = openInvoice(step, change.invoiceId);
      const lag = Date.parse(collection.payoutOn) - Date.parse(collection.payOn);
      collection.payOn = futureDate(step, change.payOn, "discount payment");
      collection.payoutOn = addDays(collection.payOn, lag / 86_400_000);
      collection.grossAmount = invoice.amount - Math.round((invoice.amount * change.percent) / 100);
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
      return; // Read from the ledger whenever a covered payroll run posts.
  }
}

/** Biweekly saving per hire-shift covering the run date, capped at the run. */
function payrollSaving(runtime: Runtime, date: string, amount: number): number {
  let saving = 0;
  for (const { change } of runtime.appliedEvents)
    if (change.kind === "shift_hire" && change.fromDate <= date && date <= change.toDate)
      saving += Math.round((change.monthlyCost * 12) / 26);
  return Math.min(saving, amount);
}

/** Issue every plan occurrence due through the new cutoff; ended plans only move the cursor. */
function issuePlans(step: Step) {
  const { snapshot } = step.world;
  for (const plan of snapshot.billingPlans ?? []) {
    while (plan.nextInvoiceDate <= step.to) {
      const issued = plan.nextInvoiceDate;
      if (!plan.endDate || issued <= plan.endDate) {
        // JSON pair encoding cannot collide however plan IDs are spelled.
        const invoice = {
          id: `inv_${JSON.stringify([plan.id, issued])}`,
          customerId: plan.customerId,
          amount: plan.amount,
          issued,
          due: addDays(issued, plan.paymentTermsDays),
          billingPlanId: plan.id,
        };
        snapshot.invoices.push(invoice);
        step.runtime.collections.push(scheduleCollection(step.world.seed, invoice));
      }
      plan.nextInvoiceDate = nextOccurrence(plan.anchorDate, issued, plan.everyMonths);
    }
  }
}

/**
 * Known obligations at the existing rates: weekly operations (Mondays), monthly rent on
 * the fixture's 5th, biweekly payroll. Bills appear two weeks ahead; payroll keeps a run
 * beyond the cutoff so the unposted tail is never a reduced actual.
 */
function scheduleObligations(step: Step) {
  const { snapshot } = step.world;
  const horizon = addDays(step.to, 14);
  const addBill = (id: string, vendor: string, amount: number, due: string, critical: boolean) => {
    if (due <= step.from || due > horizon) return;
    if (snapshot.bills.some((bill) => bill.vendor === vendor && bill.due === due)) return;
    snapshot.bills.push({ id, vendor, amount, due, critical });
    step.runtime.billPayments.push({ billId: id, payOn: due });
  };
  for (let monday = OPS_ANCHOR; monday <= horizon; monday = addDays(monday, 7))
    addBill(`bill_ops_${monday}`, "Operations vendors", 3_500_000, monday, false);
  for (let fifth = RENT_ANCHOR; fifth <= horizon; fifth = nextOccurrence(RENT_ANCHOR, fifth, 1))
    addBill(`bill_rent_${fifth}`, "Office landlord", 6_200_000, fifth, true);
  const runs = snapshot.payroll;
  const last = runs.reduce((a, b) => (b.date > a.date ? b : a));
  for (let date = addDays(last.date, 14); date <= addDays(step.to, 28); date = addDays(date, 14))
    runs.push({ id: `pay_${date}`, date, amount: last.amount });
}

function post(step: Step, txn: WorldState["snapshot"]["bankTxns"][number]) {
  const { snapshot } = step.world;
  if (snapshot.bankTxns.some((existing) => existing.id === txn.id))
    fail(`bank ${txn.id} posted twice`);
  snapshot.bankTxns.push(txn);
  snapshot.cashOnHand += txn.amount;
  if (!Number.isSafeInteger(snapshot.cashOnHand)) fail("cash left the safe integer range");
}

function settle(step: Step) {
  const { snapshot } = step.world;
  const due = (date: string) => date > step.from && date <= step.to;
  snapshot.pendingPayouts ??= [];
  for (const entry of step.runtime.collections.filter((c) => c.payOn <= step.to)) {
    const invoice = snapshot.invoices.find((record) => record.id === entry.invoiceId)!;
    invoice.paid = entry.payOn;
    invoice.paidAmount = entry.grossAmount;
    snapshot.pendingPayouts.push({
      id: `po_${invoice.id}`,
      amount: entry.netAmount,
      expectedArrival: entry.payoutOn,
      invoiceIds: [invoice.id],
    });
  }
  step.runtime.collections = step.runtime.collections.filter((c) => c.payOn > step.to);
  for (const payout of snapshot.pendingPayouts.filter((p) => p.expectedArrival <= step.to))
    post(step, {
      id: `bank_${payout.id}`,
      date: payout.expectedArrival,
      amount: payout.amount,
      description: `STRIPE PAYOUT ${payout.invoiceIds.join(" ")} NET FEES`,
      counterparty: "Stripe",
    });
  snapshot.pendingPayouts = snapshot.pendingPayouts.filter((p) => p.expectedArrival > step.to);
  for (const payment of step.runtime.billPayments.filter((p) => p.payOn <= step.to)) {
    const bill = snapshot.bills.find((record) => record.id === payment.billId)!;
    bill.paid = payment.payOn;
    post(step, {
      id: `bank_${bill.id}`,
      date: payment.payOn,
      amount: -bill.amount,
      description: `BILL ${bill.id}`,
      counterparty: bill.vendor,
    });
  }
  step.runtime.billPayments = step.runtime.billPayments.filter((p) => p.payOn > step.to);
  for (const run of snapshot.payroll.filter((r) => due(r.date))) {
    run.amount -= payrollSaving(step.runtime, run.date, run.amount);
    post(step, {
      id: `bank_${run.id}`,
      date: run.date,
      amount: -run.amount,
      description: `GUSTO PAYROLL ${run.id}`,
      counterparty: "Gusto",
    });
  }
  for (let date = addDays(step.from, 1); date <= step.to; date = addDays(date, 1)) {
    if (!date.endsWith("-25")) continue;
    const id = `card_${date}`;
    snapshot.cardTxns.push({
      id,
      date,
      amount: 3_800_000,
      merchant: "SOFTWARE VENDORS",
      category: "Software",
    });
    post(step, {
      id: `bank_${id}`,
      date,
      amount: -3_800_000,
      description: `CARD SETTLEMENT ${id}`,
      counterparty: "Card issuer",
    });
  }
  for (const event of step.runtime.cashEvents.filter((e) => e.date <= step.to))
    post(step, { ...event });
  step.runtime.cashEvents = step.runtime.cashEvents.filter((e) => e.date > step.to);
}

/**
 * Pure seven-day transition. Due pending events apply in stored order, then injected
 * changes in caller order; then issuance, collection and bank settlement by real date.
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
  scheduleObligations(step);
  issuePlans(step);
  settle(step);
  const { snapshot } = world;
  snapshot.bankTxns.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  world.week = step.week;
  world.today = step.to;
  snapshot.asOf = step.to;
  return WorldStateSchema.parse(world);
}
