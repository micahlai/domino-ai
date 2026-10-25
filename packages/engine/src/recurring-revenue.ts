import type { BillingPlan, CompanyModel, ISODate, Snapshot } from "@domino/contracts";
import { addDays, daysBetween, toMs } from "./dates";
import { type Ratio, ratio, roundCents } from "./money";
import type { CashItem } from "./schedule";

/**
 * Future recurring billing for the 13-week forecast. Open invoices only cover what is
 * already billed, so a subscription company's collections would vanish after a few weeks.
 * Each billing plan's unissued occurrences (nextInvoiceDate onward, on its anchored cadence,
 * never after a known endDate) become expected collections on
 *   issue date + payment terms + the customer's payment delay,
 * weighted by the observed rate at which customers have stopped paying. Pure and exact:
 * amounts are the plan amount times an exact survival fraction, rounded once.
 *
 * Payment delay, first match wins: the learned model's mean for the customer; the mean
 * observed in the snapshot (paid date minus due date over the customer's paid invoices);
 * the mean over paid invoices of customers on the same payment terms; zero.
 *
 * Expected churn: recurring revenue of customers with no open plan whose last plan ended in
 * the trailing 182 days, over the current plan revenue of every plan customer in the snapshot,
 * spread evenly over six months. An occurrence k calendar months after asOf keeps (1 - monthly rate)^k of its
 * amount. Plans with a known endDate are not haircut again after they end; they simply stop.
 */
export const RECURRING_REVENUE_METHOD = "billing-plans-1.0.0";

const LOOKBACK_DAYS = 182;
const LOOKBACK_MONTHS = 6n;

export type RecurringAssumptions = {
  /** Whole days late per customer used for projected collections */
  delayDays: Record<string, number>;
  /** Monthly churn as an exact fraction of recurring revenue */
  monthlyChurn: Ratio;
};

/** Occurrence n cadences after anchor, with the anchor day clamped to short months. */
function occurrence(anchor: ISODate, months: number): ISODate {
  const [y, m, d] = anchor.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

function monthsAhead(asOf: ISODate, date: ISODate): number {
  const index = (d: ISODate) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7));
  return Math.max(0, index(date) - index(asOf));
}

const meanDays = (values: number[]) =>
  values.length === 0 ? undefined : Math.round(values.reduce((a, b) => a + b, 0) / values.length);

function delays(snapshot: Snapshot, model: CompanyModel): Record<string, number> {
  const terms = new Map(snapshot.customers.map((c) => [c.id, c.paymentTermsDays]));
  const byCustomer = new Map<string, number[]>();
  const byTerms = new Map<number, number[]>();
  for (const invoice of snapshot.invoices) {
    if (invoice.paid === undefined || invoice.paid > snapshot.asOf) continue;
    const late = daysBetween(invoice.due, invoice.paid);
    byCustomer.set(invoice.customerId, [...(byCustomer.get(invoice.customerId) ?? []), late]);
    const t = terms.get(invoice.customerId);
    if (t !== undefined) byTerms.set(t, [...(byTerms.get(t) ?? []), late]);
  }
  const out: Record<string, number> = {};
  for (const plan of snapshot.billingPlans ?? []) {
    const id = plan.customerId;
    if (id in out) continue;
    const learned = model.customerDelayDays[id]?.mean;
    out[id] =
      learned !== undefined
        ? Math.round(learned)
        : (meanDays(byCustomer.get(id) ?? []) ??
          meanDays(byTerms.get(plan.paymentTermsDays) ?? []) ??
          0);
  }
  return out;
}

/** Recurring revenue per month of a plan, as an exact fraction of cents. */
const monthly = (plan: BillingPlan): Ratio => ratio(plan.amount, plan.everyMonths);

function churn(snapshot: Snapshot): Ratio {
  const since = addDays(snapshot.asOf, -(LOOKBACK_DAYS - 1));
  const add = (a: Ratio, b: Ratio): Ratio => ({
    num: a.num * b.den + b.num * a.den,
    den: a.den * b.den,
  });
  // A customer's current plan is its open one, else the one that ended last.
  const current = new Map<string, BillingPlan>();
  const rank = (p: BillingPlan) => p.endDate ?? "9999-12-31";
  for (const plan of snapshot.billingPlans ?? []) {
    const prior = current.get(plan.customerId);
    if (!prior || rank(plan) > rank(prior)) current.set(plan.customerId, plan);
  }
  let base = ratio(0);
  let lost = ratio(0);
  for (const plan of current.values()) {
    base = add(base, monthly(plan));
    const ended = plan.endDate;
    if (ended !== undefined && ended >= since && ended <= snapshot.asOf)
      lost = add(lost, monthly(plan));
  }
  if (base.num === 0n) return ratio(0);
  return { num: lost.num * base.den, den: lost.den * base.num * LOOKBACK_MONTHS };
}

export function recurringAssumptions(
  snapshot: Snapshot,
  model: CompanyModel,
): RecurringAssumptions {
  return { delayDays: delays(snapshot, model), monthlyChurn: churn(snapshot) };
}

/**
 * Expected collections from billing plans for the forecast weeks. Items dated after the last
 * week are left out; overdue never happens here because every occurrence is after asOf.
 */
export function recurringBillingItems(
  snapshot: Snapshot,
  model: CompanyModel,
  weeks: ISODate[],
): CashItem[] {
  const last = weeks[weeks.length - 1];
  if (!last) throw new Error("no weeks");
  const horizonEnd = toMs(addDays(last, 7));
  const { delayDays, monthlyChurn } = recurringAssumptions(snapshot, model);
  const keep: Ratio = { num: monthlyChurn.den - monthlyChurn.num, den: monthlyChurn.den };
  const items: CashItem[] = [];
  for (const plan of snapshot.billingPlans ?? []) {
    const lag = plan.paymentTermsDays + (delayDays[plan.customerId] ?? 0);
    const start = Math.round(
      (Number(plan.nextInvoiceDate.slice(0, 4)) * 12 +
        Number(plan.nextInvoiceDate.slice(5, 7)) -
        (Number(plan.anchorDate.slice(0, 4)) * 12 + Number(plan.anchorDate.slice(5, 7)))) /
        plan.everyMonths,
    );
    for (let n = start; ; n++) {
      const issued = occurrence(plan.anchorDate, n * plan.everyMonths);
      if (issued < plan.nextInvoiceDate) continue;
      if (plan.endDate !== undefined && issued > plan.endDate) break;
      if (toMs(issued) >= horizonEnd) break;
      const date = addDays(issued, Math.max(lag, 0));
      if (toMs(date) >= horizonEnd) break;
      const k = BigInt(monthsAhead(snapshot.asOf, issued));
      const amount = roundCents({
        num: BigInt(plan.amount) * keep.num ** k,
        den: keep.den ** k,
      });
      if (amount > 0)
        items.push({
          kind: "plan",
          id: `${plan.id}@${issued}`,
          customerId: plan.customerId,
          date,
          amount,
        });
    }
  }
  return items;
}
