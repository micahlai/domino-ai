import type { CompanyModel, HistoryWeek, ISODate, PastEvent, Snapshot } from "@domino/contracts";
import { addDays, daysBetween, toMs } from "./dates";
import { money } from "./dominoes";
import { compareIds } from "./funding";
import { spikeExtra } from "./risks";

const LATE_DAYS = 14;

/** The Monday on or before a date. */
function mondayOf(date: ISODate): ISODate {
  const dow = new Date(toMs(date)).getUTCDay();
  return addDays(date, -((dow + 6) % 7));
}

/**
 * Build-spec §6.6. Weekly closes rebuilt backward from cashOnHand (taken as the bank balance at
 * the end of asOf) by undoing bank transactions dated after each close and on or before asOf.
 * The last bucket is the partial week through asOf, not a future close. Usable subtracts today's
 * restrictedCash as a constant: no historical restricted balance exists.
 */
export function history(snapshot: Snapshot, weeks: number): HistoryWeek[] {
  if (!Number.isInteger(weeks) || weeks < 0) throw new Error("weeks must be a whole number >= 0");
  const lastMonday = mondayOf(snapshot.asOf);
  const txns = snapshot.bankTxns.filter((t) => t.date <= snapshot.asOf);
  return Array.from({ length: weeks }, (_, i) => {
    const weekStart = addDays(lastMonday, -7 * (weeks - 1 - i));
    const close = i === weeks - 1 ? snapshot.asOf : addDays(weekStart, 6);
    const after = txns.reduce((sum, t) => (t.date > close ? sum + t.amount : sum), 0);
    const closing = snapshot.cashOnHand - after;
    return { weekStart, closing, usable: closing - snapshot.restrictedCash };
  });
}

/**
 * Build-spec §6.6 markers from observable dated records only (on or before asOf). Churn and
 * usage need signals the inputs do not carry, so they are omitted. Big-deal signings are omitted
 * too: Deal.expectedClose is a plan, not an actual signing date, and no such timestamp exists yet.
 * A payroll increase is shown as a payroll change: it alone does not prove a hire.
 */
export function pastEvents(snapshot: Snapshot, _model: CompanyModel): PastEvent[] {
  const events = [...latePaid(snapshot), ...payrollSteps(snapshot), ...spendSpikes(snapshot)];
  return events.sort((a, b) =>
    a.date === b.date ? compareIds(a.id, b.id) : a.date < b.date ? -1 : 1,
  );
}

function latePaid(snapshot: Snapshot): PastEvent[] {
  return snapshot.invoices.flatMap((inv) => {
    if (!inv.paid || inv.paid > snapshot.asOf) return [];
    // Gross actually collected; an agreed collection amount is a plan, not proof of payment.
    const amount = inv.paidAmount ?? inv.amount;
    const late = daysBetween(inv.due, inv.paid);
    if (late <= LATE_DAYS) return [];
    const name = snapshot.customers.find((c) => c.id === inv.customerId)?.name ?? inv.customerId;
    return [
      {
        id: `past_late_${inv.id}`,
        date: inv.paid,
        label: `${name} paid ${money(amount)} ${late} days late`,
        kind: "late_payment" as const,
        amount,
        evidence: [
          { source: "stripe" as const, ref: inv.id, note: `Due ${inv.due}, paid ${inv.paid}` },
        ],
      },
    ];
  });
}

/** Each run on or before asOf that costs more than the previous run. Amount = extra cash out. */
function payrollSteps(snapshot: Snapshot): PastEvent[] {
  const runs = snapshot.payroll
    .filter((r) => r.date <= snapshot.asOf)
    .sort((a, b) => (a.date === b.date ? compareIds(a.id, b.id) : a.date < b.date ? -1 : 1));
  return runs.flatMap((run, i) => {
    const prev = runs[i - 1];
    if (!prev || run.amount <= prev.amount) return [];
    return [
      {
        id: `past_payroll_${run.id}`,
        date: run.date,
        label: `Payroll rose from ${money(prev.amount)} to ${money(run.amount)} per run`,
        kind: "other" as const,
        amount: -(run.amount - prev.amount),
        evidence: [
          {
            source: "payroll" as const,
            ref: prev.id,
            note: `Run on ${prev.date}: ${money(prev.amount)}`,
          },
          {
            source: "payroll" as const,
            ref: run.id,
            note: `Run on ${run.date}: ${money(run.amount)}`,
          },
        ],
      },
    ];
  });
}

function spendSpikes(snapshot: Snapshot): PastEvent[] {
  const spike = spikeExtra(snapshot);
  if (!spike) return [];
  return [
    {
      id: "past_spend_spike",
      date: spike.end,
      label: `Card spend rose ${money(spike.extra)} over the prior four weeks`,
      kind: "spend_spike",
      amount: -spike.extra,
      evidence: spike.records.map((t) => ({
        source: "ramp" as const,
        ref: t.id,
        note: `${t.merchant} ${money(t.amount)} on ${t.date}`,
      })),
    },
  ];
}
