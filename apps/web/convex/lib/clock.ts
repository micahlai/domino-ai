import type { Snapshot, WorldState } from "@domino/contracts";
import { type ProfileId, advanceProfileDays, isProfileId, isProfileWorld } from "@domino/sim";
import { type Overlay, servedSnapshot } from "../fieldFeed";
import { money } from "./judge";
import { type Fired, daysBetween, dueBeats, resolveBeat } from "./storylines";

/**
 * Simulated clock rules (pure, no Convex functions). One tick moves the mock world one day with
 * the day-by-day simulator (packages/sim advanceProfileDays), fires that day's storyline beats
 * and reports which new entries the mock sources now serve. fieldClock.ts runs it on a schedule.
 */

/** Wall time per simulated day at each speed: 1x is one day every 6 s. */
export const SPEEDS = [1, 5, 20] as const;
export type Speed = (typeof SPEEDS)[number];
export const DAY_MS_AT_1X = 6_000;
export const intervalMs = (speed: Speed) => DAY_MS_AT_1X / speed;
export const isSpeed = (n: number): n is Speed => (SPEEDS as readonly number[]).includes(n);

/** One play session stops itself after 13 simulated weeks or 60 minutes of wall time. */
export const SESSION_MAX_DAYS = 91;
export const SESSION_MAX_MS = 60 * 60_000;
/** The clock never runs more than a year past its start. */
export const CLOCK_MAX_DAYS = 364;

export const profileOfWorld = (world: WorldState): ProfileId | null =>
  isProfileWorld(world) && isProfileId(world.companyId) ? world.companyId : null;

/** Why a playing clock must pause now, or null to keep going. */
export function pauseReason(c: {
  day: number;
  sessionStartDay: number;
  playStartedAt: number | null;
  now: number;
}): string | null {
  if (c.day >= CLOCK_MAX_DAYS) return `the clock reached its limit of ${CLOCK_MAX_DAYS} days`;
  if (c.day - c.sessionStartDay >= SESSION_MAX_DAYS) return "13 simulated weeks played";
  if (c.playStartedAt !== null && c.now - c.playStartedAt >= SESSION_MAX_MS)
    return "60 minutes of wall time";
  return null;
}

export interface DayEntries {
  /** New or changed records across every source. 0 = nothing for the agents to read. */
  total: number;
  customerPayments: number;
  customerCents: number;
  payrollDebits: number;
  payrollCents: number;
  billPayments: number;
  billsArrived: number;
  cardCharges: number;
  otherBank: number;
  invoicesIssued: number;
  /** Ids of the new records, for the log row refs. */
  refs: string[];
}

/** What changed in the served records from one day to the next. */
export function dayEntries(before: Snapshot, after: Snapshot): DayEntries {
  const seen = (list: { id: string }[]) => new Set(list.map((r) => r.id));
  const fresh = <T extends { id: string }>(prev: T[], next: T[]) => {
    const old = seen(prev);
    return next.filter((r) => !old.has(r.id));
  };
  const bank = fresh(before.bankTxns, after.bankTxns);
  const isCustomer = (t: Snapshot["bankTxns"][number]) =>
    t.amount > 0 && (t.id.startsWith("bank_ach_") || t.id.startsWith("bank_po_"));
  const isPayroll = (t: Snapshot["bankTxns"][number]) => t.counterparty === "Gusto";
  const isBill = (t: Snapshot["bankTxns"][number]) => t.id.startsWith("bank_bill_");
  const customer = bank.filter(isCustomer);
  const payroll = bank.filter(isPayroll);
  const bills = fresh(before.bills, after.bills);
  const cards = fresh(before.cardTxns, after.cardTxns);
  const invoices = fresh(before.invoices, after.invoices);
  const runs = fresh(before.payroll, after.payroll);
  // A record whose content changed counts once, like a new one (paid, rewritten, ended).
  const changed = (prev: { id: string }[], next: { id: string }[]) => {
    const old = new Map(prev.map((r) => [r.id, JSON.stringify(r)]));
    return next.filter((r) => old.has(r.id) && old.get(r.id) !== JSON.stringify(r)).length;
  };
  const edits =
    changed(before.invoices, after.invoices) +
    changed(before.bills, after.bills) +
    changed(before.billingPlans ?? [], after.billingPlans ?? []) +
    changed(before.deals, after.deals);
  const sum = (xs: { amount: number }[]) => xs.reduce((n, x) => n + x.amount, 0);
  return {
    total: bank.length + bills.length + cards.length + invoices.length + runs.length + edits,
    customerPayments: customer.length,
    customerCents: sum(customer),
    payrollDebits: payroll.length,
    payrollCents: -sum(payroll),
    billPayments: bank.filter(isBill).length,
    billsArrived: bills.length,
    cardCharges: cards.length,
    otherBank: bank.length - customer.length - payroll.length - bank.filter(isBill).length,
    invoicesIssued: invoices.length,
    refs: [...bank, ...bills, ...cards, ...invoices, ...runs].map((r) => r.id).slice(0, 64),
  };
}

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** One line for the log: "Nov 9: 5 customer payments ($1.2M) landed, payroll ran, ..." */
export function entriesText(date: string, e: DayEntries): string {
  if (e.total === 0) return `${date}: no new entries (a quiet day)`;
  const parts = [
    e.customerPayments > 0 &&
      `${n(e.customerPayments, "customer payment")} landed (${money(e.customerCents)})`,
    e.payrollDebits > 0 && `payroll ran (${money(e.payrollCents)})`,
    e.billPayments > 0 && `${n(e.billPayments, "bill")} paid`,
    e.billsArrived > 0 && `${n(e.billsArrived, "new bill")} arrived`,
    e.cardCharges > 0 && `${n(e.cardCharges, "card charge")}`,
    e.invoicesIssued > 0 && `${n(e.invoicesIssued, "invoice")} issued`,
    e.otherBank > 0 && `${n(e.otherBank, "other bank line")}`,
  ].filter((p): p is string => typeof p === "string");
  return `${date}: ${parts.length > 0 ? parts.join(", ") : `${n(e.total, "record")} updated`}`;
}

export interface Step {
  world: WorldState;
  overlay: Overlay;
  day: number;
  fired: Fired[];
  entries: DayEntries;
  /** What the sources served before and after the step (the vendors' webhooks derive from it). */
  served: { before: Snapshot; after: Snapshot };
}

/**
 * Move the mock world `days` days on (default one) and fire every storyline beat due by the new
 * day. Pure and deterministic: the same world, overlay and origin give the same step.
 */
export function stepDays(world: WorldState, overlay: Overlay, origin: string, days = 1): Step {
  const profile = profileOfWorld(world);
  if (!profile) throw new Error("The simulated clock runs on driver-based companies only");
  const before = servedSnapshot(world, overlay);
  const next = advanceProfileDays(world, days);
  const day = daysBetween(origin, next.today);
  let story = overlay.story ?? { fired: [] };
  let bills = overlay.bills;
  const fired: Fired[] = [];
  for (const beat of dueBeats(profile, story, day)) {
    const served = servedSnapshot(next, { ...overlay, bills, story });
    const r = resolveBeat(served, beat, day);
    fired.push(r.fired);
    story = { fired: [...story.fired, r.fired] };
    bills = [...bills, ...r.bills];
  }
  const nextOverlay: Overlay = fired.length > 0 ? { ...overlay, bills, story } : overlay;
  const after = servedSnapshot(next, nextOverlay);
  return {
    world: next,
    overlay: nextOverlay,
    day,
    fired,
    entries: dayEntries(before, after),
    served: { before, after },
  };
}
