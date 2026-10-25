import type {
  Bill,
  Change,
  CompanyModel,
  Evidence,
  Invoice,
  RiskEvent,
  Snapshot,
} from "@domino/contracts";
import { addDays, daysBetween, weekStarts } from "./dates";
import type { CashSchedule } from "./forecast";
import { compareIds } from "./funding";
import { isOpenInvoice } from "./schedule";

/**
 * More risk kinds for scanRisks, each built only from the snapshot's own records. A kind is
 * skipped when its records are missing. Impact is computed by scanRisks through forecast.
 * Chance rules are stated per kind; "demo assumption" marks a chance that is not estimated.
 */
export type Candidate = Omit<RiskEvent, "impactLowPoint">;

const LATE_DAYS = 14;
const MIN_SAMPLES = 3;
const DEFAULT_CHANCE = 0.1;
/** At most this many changes per candidate, the Timeline analysis budget. */
const MAX_CHANGES = 8;
/** Demo assumption: vendor price rise when the vendor's own bills never rose. */
const DEFAULT_RISE_PCT = 10;
const MAX_RISE_PCT = 25;
/** Demo assumption: a processor payout lands a week after its estimated arrival. */
const PAYOUT_LATE_DAYS = 7;
const PAYOUT_LATE_CHANCE = 0.15;
/** Assumption: a customer that stopped paying slips its later invoices at most this long. */
const MAX_OVERDUE_SLIP = 60;
/** Approximate days per billing cadence, for a recurring flow on a known plan. */
const CADENCE_DAYS: Record<1 | 3, number> = { 1: 30, 3: 91 };
/** Demo assumption: an early payer pays this many days before due when history has none. */
const DEFAULT_EARLY_DAYS = 14;
/** Payroll runs above this multiple of the median are bonus runs, not the base run-rate. */
const BONUS_RATIO = 1.15;
/** Bill vendors that are scheduled obligations (tax, insurance), not priced supply. */
const SCHEDULED = /\b(tax|insurance|premium)\b/i;
/** Not a repriceable supply: interest, loans, fees, leases, card statements and capex. */
const NOT_PRICED =
  /\b(tax|insurance|premium|interest|loan|principal|fee|fees|rent|lease|statement|card|capex)\b/i;

const addMonths = (date: string, n: number) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = y * 12 + (m - 1) + n;
  const last = new Date(Date.UTC(Math.floor(t / 12), (t % 12) + 1, 0)).getUTCDate();
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "$1.2M", "$340K", "$85": display only; stored values stay integer cents. */
export function short(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const d = Math.abs(cents) / 100;
  if (d >= 1_000_000) return `${sign}$${(d / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (d >= 1_000) return `${sign}$${Math.round(d / 1_000)}K`;
  return `${sign}$${Math.round(d)}`;
}

/** "Nov 13" (adds the year when it differs from asOf's). */
export function day(date: string, asOf?: string): string {
  const [y, m, d] = date.split("-");
  const base = `${MONTHS[Number(m) - 1]} ${Number(d)}`;
  return asOf && asOf.slice(0, 4) !== y ? `${base}, ${y}` : base;
}

export const customerName = (snapshot: Snapshot, id: string) =>
  snapshot.customers.find((c) => c.id === id)?.name ?? "A customer";

export function horizonEnd(snapshot: Snapshot): string {
  const weeks = weekStarts(snapshot.asOf, 13);
  return addDays(weeks[12] ?? snapshot.asOf, 6);
}

const inHorizon = (snapshot: Snapshot, date: string) =>
  date > snapshot.asOf && date <= horizonEnd(snapshot);

const sum = (rows: { amount: number }[]) => rows.reduce((n, r) => n + r.amount, 0);
const byDate =
  <T extends { id: string }>(date: (t: T) => string) =>
  (a: T, b: T) =>
    date(a) === date(b) ? compareIds(a.id, b.id) : date(a) < date(b) ? -1 : 1;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
};
const pct = (cents: number, p: number) => Math.floor((cents * p) / 100);

const observablePaid = (snapshot: Snapshot, customerId: string) =>
  snapshot.invoices
    .filter((i) => i.customerId === customerId && i.paid !== undefined && i.paid <= snapshot.asOf)
    .sort((a, b) => compareIds(a.id, b.id));
const daysLate = (i: Invoice) => daysBetween(i.due, i.paid ?? i.due);
const expectedDelay = (model: CompanyModel, customerId: string) =>
  Math.round(model.customerDelayDays[customerId]?.mean ?? 0);

const isReceipt = (kind: string) => kind === "invoice" || kind === "deal" || kind === "plan";

/** The base forecast's cash date for one invoice, if it is still expected. */
export const receiptDate = (base: CashSchedule, invoiceId: string): string | undefined =>
  base.items.find((i) => i.kind === "invoice" && i.id === invoiceId)?.date;

/**
 * Earliest expected receipt (invoice, deal or projected plan bill) from a customer in the base
 * forecast, skipping one invoice. A persistent change from this date reaches all of them.
 */
export function firstReceipt(
  base: CashSchedule,
  customerId: string,
  skipInvoiceId?: string,
): string | undefined {
  let first: string | undefined;
  for (const i of base.items)
    if (isReceipt(i.kind) && i.customerId === customerId && i.id !== skipInvoiceId)
      if (first === undefined || i.date < first) first = i.date;
  return first;
}

// ---------- Vendor price rise ----------

/**
 * The two largest priced vendors by unpaid bills in the horizon. Size: the vendor's own largest
 * bill-to-bill rise (capped at 25%), else a 10% demo assumption. Chance: (rises + 1) /
 * (steps + 2) over the vendor's consecutive bills (Laplace rule, so a flat history is not 0).
 */
export function vendorPriceRises(snapshot: Snapshot): Candidate[] {
  const upcoming = snapshot.bills.filter(
    (b) => !b.paid && b.amount > 0 && inHorizon(snapshot, b.due) && !NOT_PRICED.test(b.vendor),
  );
  const totals = new Map<string, Bill[]>();
  for (const b of upcoming) totals.set(b.vendor, [...(totals.get(b.vendor) ?? []), b]);
  return [...totals.entries()]
    .sort((a, b) => sum(b[1]) - sum(a[1]) || (a[0] < b[0] ? -1 : 1))
    .slice(0, 2)
    .map(([vendor, bills]) => {
      const history = snapshot.bills.filter((b) => b.vendor === vendor).sort(byDate((b) => b.due));
      let steps = 0;
      let rises = 0;
      let maxRise = 0;
      for (let i = 1; i < history.length; i++) {
        const prev = history[i - 1]!.amount;
        const next = history[i]!.amount;
        if (prev <= 0) continue;
        steps++;
        if (next > prev) {
          rises++;
          maxRise = Math.max(maxRise, Math.ceil(((next - prev) * 100) / prev));
        }
      }
      const risePct = maxRise > 0 ? Math.min(maxRise, MAX_RISE_PCT) : DEFAULT_RISE_PCT;
      const sorted = [...bills].sort(byDate((b) => b.due));
      const from = sorted[0]!.due;
      // A price rise is persistent: every later bill from this vendor costs more, not one bill.
      const change: Change = {
        kind: "scale_recurring",
        label: `${vendor} prices up ${risePct}%`,
        flows: "spend",
        names: [vendor],
        percent: risePct,
        fromDate: from,
      };
      const extra = sorted.reduce((n, b) => n + pct(b.amount, risePct), 0);
      const probability = (rises + 1) / (steps + 2);
      const sizeNote =
        maxRise > 0
          ? `${risePct}% is this vendor's largest observed bill-to-bill rise${maxRise > MAX_RISE_PCT ? ` (capped from ${maxRise}%)` : ""}`
          : `Demo assumption: ${DEFAULT_RISE_PCT}% rise; this vendor's bills never rose in the records`;
      const evidence: Evidence[] = [
        {
          source: "books",
          ref: `vendor:${vendor}`,
          note: `${rises} of ${steps} consecutive bills rose; chance (${rises}+1)/(${steps}+2) by the Laplace rule. ${sizeNote}. The rise applies to every ${vendor} bill and recurring charge from ${from} on.`,
        },
        ...sorted.slice(0, MAX_CHANGES).map((b) => ({
          source: "books" as const,
          ref: b.id,
          note: `Unpaid ${short(b.amount)} bill due ${b.due}`,
        })),
      ];
      return {
        id: `risk_vendor_${sorted[0]!.id}`,
        label: `${vendor} raises prices ${risePct}% from ${day(from, snapshot.asOf)}: every later bill costs more (+${short(extra)} across ${sorted.length} booked bill${sorted.length === 1 ? "" : "s"})`,
        probability,
        changes: [change],
        evidence,
        extra,
      };
    })
    .filter((c) => c.extra > 0)
    .map(({ extra: _, ...c }) => c);
}

// ---------- Payroll growth ----------

/**
 * Hiring continues at the recent pace: base runs (bonus runs excluded) averaged over the last
 * three versus the three before. Each future run in the horizon grows by that step. Chance:
 * share of base run-to-run steps that increased. Skipped when payroll was flat or shrank.
 */
export function payrollGrowth(snapshot: Snapshot): Candidate[] {
  const past = snapshot.payroll.filter((p) => p.date <= snapshot.asOf).sort(byDate((p) => p.date));
  const med = median(past.map((p) => p.amount));
  const base = past.filter((p) => p.amount <= med * BONUS_RATIO);
  if (base.length < 6) return [];
  const last3 = base.slice(-3);
  const prev3 = base.slice(-6, -3);
  const step = Math.floor((sum(last3) - sum(prev3)) / 3);
  if (step <= 0) return [];
  let ups = 0;
  for (let i = 1; i < base.length; i++) if (base[i]!.amount > base[i - 1]!.amount) ups++;
  const probability = ups / (base.length - 1);
  const future = snapshot.payroll
    .filter((p) => inHorizon(snapshot, p.date))
    .sort(byDate((p) => p.date))
    .slice(0, MAX_CHANGES);
  if (!future.length || probability === 0) return [];
  const gaps = base
    .slice(-6)
    .flatMap((p, i, xs) => (i ? [daysBetween(xs[i - 1]!.date, p.date)] : []));
  const everyDays = Math.min(31, Math.max(7, Math.round(median(gaps))));
  // Each run adds one more hire's pay, and every hire stays on payroll for every later run.
  const changes: Change[] = future.map((p) => ({
    kind: "recurring_cash",
    label: `New hires from ${p.date}`,
    direction: "out",
    amount: step,
    fromDate: p.date,
    everyDays,
  }));
  const extra = (step * future.length * (future.length + 1)) / 2;
  return [
    {
      id: "risk_payroll_growth",
      label: `Hiring keeps its pace: each pay run from ${day(future[0]!.date, snapshot.asOf)} adds ${short(step)} that stays on payroll (about +${short(extra)} in 13 weeks)`,
      probability,
      changes,
      evidence: [
        {
          source: "payroll",
          ref: "payroll:base-runs",
          note: `Last three base runs average ${short(sum(last3) / 3)}, the three before ${short(sum(prev3) / 3)}. ${ups} of ${base.length - 1} run-to-run steps rose, which is the chance. Runs above ${BONUS_RATIO}x the median are treated as bonuses and excluded. New pay repeats every ${everyDays} days, the median gap between recent base runs.`,
        },
        ...last3.map((p) => ({
          source: "payroll" as const,
          ref: p.id,
          note: `${short(p.amount)} run on ${p.date}`,
        })),
      ],
    },
  ];
}

// ---------- Scheduled tax or insurance payment ----------

/**
 * Tax and insurance vendors repeat on their own cadence: the gap between their last two bills,
 * or one year with a single bill. When the next occurrence lands in the horizon and no bill
 * for it is booked yet, the forecast misses it. Amount: the last bill. Chance: n / (n + 1) for
 * n observed bills (rule of succession), capped at 0.9: a stated assumption, not a rate.
 */
export function scheduledPayments(snapshot: Snapshot): Candidate[] {
  const vendors = new Map<string, Bill[]>();
  for (const b of snapshot.bills)
    if (SCHEDULED.test(b.vendor) && b.amount > 0)
      vendors.set(b.vendor, [...(vendors.get(b.vendor) ?? []), b]);
  const out: (Candidate & { amount: number })[] = [];
  for (const [vendor, rows] of vendors) {
    const bills = [...rows].sort(byDate((b) => b.due));
    const last = bills[bills.length - 1]!;
    const prev = bills[bills.length - 2];
    const gap = prev ? daysBetween(prev.due, last.due) : 365;
    if (gap < 20) continue;
    // A calendar-quarter cadence keeps its day of month (Jul 20 -> Oct 20 -> Jan 20).
    const next = gap >= 85 && gap <= 95 ? addMonths(last.due, 3) : addDays(last.due, gap);
    if (!inHorizon(snapshot, next)) continue;
    const booked = snapshot.bills.some(
      (b) => b.vendor === vendor && b !== last && Math.abs(daysBetween(b.due, next)) <= 15,
    );
    if (booked) continue;
    const n = bills.length;
    const probability = Math.min(0.9, n / (n + 1));
    out.push({
      id: `risk_due_${last.id}`,
      label: `${vendor} of about ${short(last.amount)} comes due ${day(next, snapshot.asOf)}, not yet booked`,
      probability,
      amount: last.amount,
      changes: [
        { kind: "remove_cash", date: next, amount: last.amount, label: `${vendor} ${next}` },
      ],
      evidence: [
        ...bills.map((b) => ({
          source: "books" as const,
          ref: b.id,
          note: `${short(b.amount)} due ${b.due}`,
        })),
        {
          source: "learned",
          ref: `cadence:${vendor}`,
          note: `Next ${next} is the last bill plus ${prev ? `the ${gap}-day gap between the last two` : "one year (a single bill on record)"}. Chance ${n}/(${n}+1) from ${n} observed bills, a stated assumption.`,
        },
      ],
    });
  }
  return out
    .sort((a, b) => b.amount - a.amount || compareIds(a.id, b.id))
    .slice(0, 2)
    .map(({ amount: _, ...c }) => c);
}

// ---------- Concentration: top customer pays at its worst ----------

/**
 * Among customers with payment history, the one with the most open receivables in the horizon
 * pays everything at its own worst observed lateness: its open invoices and every later one, since
 * a customer that slips keeps slipping. The forecast already adds its rounded mean delay, so the
 * extra is worst - round(mean). Chance: share of its observable paid invoices more than 14 days
 * late, or the documented 0.1 default with fewer than three.
 */
export function concentration(
  snapshot: Snapshot,
  model: CompanyModel,
  base: CashSchedule,
): Candidate[] {
  // Overdue invoices count: they are still expected cash and are the likeliest to slip.
  const open = snapshot.invoices.filter(
    (i) => isOpenInvoice(i) && i.amount > 0 && i.due <= horizonEnd(snapshot),
  );
  const totals = new Map<string, number>();
  for (const i of open) totals.set(i.customerId, (totals.get(i.customerId) ?? 0) + i.amount);
  const top = [...totals.entries()]
    .filter(([id]) => observablePaid(snapshot, id).length > 0)
    .sort((a, b) => b[1] - a[1] || compareIds(a[0], b[0]))[0];
  if (!top) return [];
  const [customerId, total] = top;
  const history = observablePaid(snapshot, customerId);
  const worst = Math.max(...history.map(daysLate));
  const extra = worst - expectedDelay(model, customerId);
  if (extra <= 0) return [];
  const late = history.filter((i) => daysLate(i) > LATE_DAYS).length;
  const enough = history.length >= MIN_SAMPLES;
  const probability = enough ? late / history.length : DEFAULT_CHANCE;
  if (probability === 0) return [];
  const fromDate = firstReceipt(base, customerId);
  if (fromDate === undefined) return [];
  const targets = open
    .filter((i) => i.customerId === customerId)
    .sort((a, b) => b.amount - a.amount || compareIds(a.id, b.id))
    .slice(0, MAX_CHANGES);
  const name = customerName(snapshot, customerId);
  const worstInv = history.find((i) => daysLate(i) === worst)!;
  const change: Change = {
    kind: "delay_customer",
    customerId,
    days: extra,
    fromDate,
    basis: `Worst observed lateness ${worst} days (${worstInv.id}) minus the ${expectedDelay(model, customerId)} days already forecast`,
  };
  return [
    {
      id: `risk_concentration_${customerId}`,
      label: `Top customer ${name} pays everything at its worst, ${worst} days late as on ${day(worstInv.due, snapshot.asOf)}: the ${short(total)} open and all later invoices`,
      probability,
      changes: [change],
      evidence: [
        {
          source: "stripe",
          ref: worstInv.id,
          note: `Worst observed: due ${worstInv.due}, paid ${worstInv.paid}, ${worst} days late. ${enough ? `${late} of ${history.length} paid invoices were more than ${LATE_DAYS} days late` : `Assumption: only ${history.length} paid invoices, so the documented ${DEFAULT_CHANCE} default`}.`,
        },
        ...targets.map((i) => ({
          source: "stripe" as const,
          ref: i.id,
          note: `Open ${short(i.amount)} invoice due ${i.due}, delayed ${extra} days beyond the usual`,
        })),
      ],
    },
  ];
}

// ---------- Overdue invoice never collected ----------

/**
 * The largest open invoice already past due (not one a renewal deal carries; nonrenewal covers
 * those) is never collected, and the customer keeps paying late: its other receipts slip by as
 * long as this one is overdue, capped at 60 days (assumption). Chance: demo assumption of days
 * overdue / 120, capped at 0.5, so older debts are likelier to be lost. Not an estimated
 * write-off rate.
 */
export function overdueUncollected(snapshot: Snapshot, base: CashSchedule): Candidate[] {
  const renewal = new Set(
    snapshot.deals.filter((d) => d.kind === "renewal" && d.invoiceId).map((d) => d.invoiceId),
  );
  const inv = snapshot.invoices
    .filter((i) => isOpenInvoice(i) && i.amount > 0 && i.due < snapshot.asOf && !renewal.has(i.id))
    .sort((a, b) => b.amount - a.amount || compareIds(a.id, b.id))[0];
  if (!inv) return [];
  const overdue = daysBetween(inv.due, snapshot.asOf);
  const probability = Math.min(0.5, overdue / 120);
  const slip = Math.min(overdue, MAX_OVERDUE_SLIP);
  const later = firstReceipt(base, inv.customerId, inv.id);
  const name = customerName(snapshot, inv.customerId);
  const changes: Change[] = [{ kind: "lose_invoice", invoiceId: inv.id }];
  if (later !== undefined && slip > 0)
    changes.push({
      kind: "delay_customer",
      customerId: inv.customerId,
      days: slip,
      fromDate: later,
      basis: `Assumption: a customer that stopped paying keeps paying late, by as long as ${inv.id} is overdue (${overdue} days, capped at ${MAX_OVERDUE_SLIP})`,
    });
  return [
    {
      id: `risk_overdue_${inv.id}`,
      label: `${name} never pays its ${short(inv.amount)} invoice, ${overdue} days overdue since ${day(inv.due, snapshot.asOf)}${changes.length > 1 ? `, and pays later invoices ${slip} days late` : ""}`,
      probability,
      changes,
      evidence: [
        {
          source: "stripe",
          ref: inv.id,
          note: `Open ${short(inv.amount)} invoice due ${inv.due}, ${overdue} days overdue at ${snapshot.asOf}. Demo assumption: chance = days overdue / 120, capped at 0.5.${changes.length > 1 ? ` Assumption: its later invoices slip ${slip} days.` : ""}`,
        },
      ],
    },
  ];
}

// ---------- Planned inflow arrives late ----------

/**
 * The largest pending processor payout in the horizon lands a week late (demo assumption for
 * both the 7 days and the 0.15 chance; the records hold no history of estimated arrivals).
 */
export function payoutLate(snapshot: Snapshot): Candidate[] {
  const payout = (snapshot.pendingPayouts ?? [])
    .filter((p) => p.amount > 0 && inHorizon(snapshot, p.expectedArrival))
    .sort((a, b) => b.amount - a.amount || compareIds(a.id, b.id))[0];
  if (!payout) return [];
  const later = addDays(payout.expectedArrival, PAYOUT_LATE_DAYS);
  return [
    {
      id: `risk_inflow_late_${payout.id}`,
      label: `${short(payout.amount)} processor payout due ${day(payout.expectedArrival, snapshot.asOf)} lands ${PAYOUT_LATE_DAYS} days late`,
      probability: PAYOUT_LATE_CHANCE,
      changes: [
        {
          kind: "remove_cash",
          date: payout.expectedArrival,
          amount: payout.amount,
          label: `Payout ${payout.id} not on time`,
        },
        { kind: "add_cash", date: later, amount: payout.amount, label: `Payout ${payout.id} late` },
      ],
      evidence: [
        {
          source: "stripe",
          ref: payout.id,
          note: `Pending ${short(payout.amount)} payout, estimated arrival ${payout.expectedArrival}. Demo assumption: ${PAYOUT_LATE_DAYS} days late with a ${PAYOUT_LATE_CHANCE} chance, not an estimated rate.`,
        },
      ],
    },
  ];
}

// ---------- Upside ----------

/**
 * Upside: the largest open invoice in the horizon is collected early. Early days: the
 * customer's median early payment, else a 14-day demo assumption. Chance: share of its
 * observable paid invoices paid before due, or the 0.1 default with fewer than three.
 */
export function earlyCollection(snapshot: Snapshot, model: CompanyModel): Candidate[] {
  const inv = snapshot.invoices
    .filter((i) => isOpenInvoice(i) && i.amount > 0 && inHorizon(snapshot, i.due))
    .sort((a, b) => b.amount - a.amount || compareIds(a.id, b.id))
    .find((i) => daysBetween(snapshot.asOf, i.due) > 7);
  if (!inv) return [];
  const history = observablePaid(snapshot, inv.customerId);
  const early = history.filter((i) => daysLate(i) < 0);
  const enough = history.length >= MIN_SAMPLES;
  const probability = enough ? early.length / history.length : DEFAULT_CHANCE;
  if (probability === 0) return [];
  const earlyDays = early.length
    ? Math.round(median(early.map((i) => -daysLate(i))))
    : DEFAULT_EARLY_DAYS;
  const target = addDays(inv.due, -earlyDays);
  const arrives = target > snapshot.asOf ? target : addDays(snapshot.asOf, 1);
  const expected = addDays(inv.due, expectedDelay(model, inv.customerId));
  const days = daysBetween(expected, arrives);
  if (days >= 0) return [];
  const name = customerName(snapshot, inv.customerId);
  return [
    {
      id: `risk_upside_early_${inv.id}`,
      label: `Upside: ${name} pays its ${short(inv.amount)} invoice early (${day(arrives, snapshot.asOf)} instead of ${day(expected, snapshot.asOf)})`,
      probability,
      changes: [{ kind: "delay_invoice", invoiceId: inv.id, days }],
      evidence: [
        {
          source: "stripe",
          ref: inv.id,
          note: `Largest open invoice in the forecast: ${short(inv.amount)} due ${inv.due}`,
        },
        {
          source: "learned",
          ref: `early:${inv.customerId}`,
          note: enough
            ? `${early.length} of ${history.length} paid invoices were paid before due${early.length ? `, median ${earlyDays} days early` : ""}`
            : `Assumption: only ${history.length} paid invoices, so the documented ${DEFAULT_CHANCE} default${early.length ? "" : ` and a ${DEFAULT_EARLY_DAYS}-day demo assumption`}`,
        },
      ],
    },
  ];
}

/**
 * Upside: the largest open new-business or expansion deal closes on its expected date and pays
 * on the customer's terms plus usual delay. When the customer already bills monthly or quarterly
 * on a plan, the deal is assumed to bill on that cadence too, so the amount repeats. Renewals are
 * left out (billing plans already carry them). Chance: won / (won + lost) over that kind's closed
 * deals; skipped with fewer than three.
 */
export function pipelineClose(snapshot: Snapshot, model: CompanyModel): Candidate[] {
  const deal = snapshot.deals
    .filter(
      (d) =>
        d.stage === "open" &&
        d.amount > 0 &&
        (d.kind === "new_business" || d.kind === "expansion") &&
        !d.invoiceId,
    )
    .sort((a, b) => b.amount - a.amount || compareIds(a.id, b.id))[0];
  if (!deal) return [];
  const closed = snapshot.deals.filter((d) => d.kind === deal.kind && d.stage !== "open");
  if (closed.length < MIN_SAMPLES) return [];
  const won = closed.filter((d) => d.stage === "won").length;
  const probability = won / closed.length;
  const customer = snapshot.customers.find((c) => c.id === deal.customerId);
  const pays = addDays(
    deal.expectedClose,
    (customer?.paymentTermsDays ?? 30) + expectedDelay(model, deal.customerId),
  );
  if (probability === 0 || !inHorizon(snapshot, pays)) return [];
  const name = customerName(snapshot, deal.customerId);
  const plan = (snapshot.billingPlans ?? [])
    .filter(
      (p) =>
        p.customerId === deal.customerId &&
        p.everyMonths !== 12 &&
        (p.endDate === undefined || p.endDate > snapshot.asOf),
    )
    .sort((a, b) => compareIds(a.id, b.id))[0];
  const everyDays = plan && plan.everyMonths !== 12 ? CADENCE_DAYS[plan.everyMonths] : undefined;
  const changes: Change[] = [
    { kind: "add_cash", date: pays, amount: deal.amount, label: `Deal ${deal.id}` },
  ];
  if (everyDays !== undefined)
    changes.push({
      kind: "recurring_cash",
      label: `Deal ${deal.id} billing`,
      direction: "in",
      amount: deal.amount,
      fromDate: addDays(pays, everyDays),
      everyDays,
    });
  const cadence = plan?.everyMonths === 1 ? "month" : "quarter";
  return [
    {
      id: `risk_upside_deal_${deal.id}`,
      label: `Upside: ${name} ${deal.kind === "expansion" ? "expansion" : "deal"} closes, ${short(deal.amount)} paid ${day(pays, snapshot.asOf)}${everyDays !== undefined ? ` and every ${cadence} after` : ""}`,
      probability,
      changes,
      evidence: [
        {
          source: "crm",
          ref: deal.id,
          note: `Open ${deal.kind} deal of ${short(deal.amount)}, expected close ${deal.expectedClose}. ${won} of ${closed.length} closed ${deal.kind} deals were won, which is the chance.`,
        },
        ...(plan && everyDays !== undefined
          ? [
              {
                source: "stripe" as const,
                ref: plan.id,
                note: `Assumption: the deal bills like ${name}'s current plan, every ${plan.everyMonths === 1 ? "month" : "quarter"} (${everyDays} days), at the deal amount`,
              },
            ]
          : []),
      ],
    },
  ];
}

/** Grouping key for the diversity cap. Upside events have their own kind. */
export function riskKind(id: string): string {
  if (id.startsWith("risk_upside_")) return "upside";
  const m = /^risk_(late|nonrenewal|spend|vendor|payroll|due|concentration|overdue|inflow)_?/.exec(
    id,
  );
  return m?.[1] ?? id;
}
