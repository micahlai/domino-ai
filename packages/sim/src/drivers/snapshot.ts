import type {
  BillingPlan,
  Customer,
  Deal,
  Invoice,
  PendingPayout,
  Snapshot,
  WorldState,
} from "@domino/contracts";
import { WorldStateSchema } from "@domino/contracts";
import { lastForecastSunday, nextOccurrence } from "../create.ts";
import { TODAY0, WEEK0, WINDOW_START, addDays, daysBetween, todayOf } from "./basics.ts";
import { lowestUsable } from "./metrics.ts";
import { PROFILES, type ProfileId, type ProfileSpec, isProfileId } from "./profiles.ts";
import { type Timeline, generateTimeline } from "./timeline.ts";

/**
 * What the company's systems show on one day: the observable cut of a timeline. Records
 * appear when they would exist (a bill once received, an invoice once issued); outcomes
 * appear only once they happen. Future payroll runs and contractual bills (lease, loan
 * principal) are published through the 13-week horizon, as payroll and books would.
 */
export function cut(timeline: Timeline, today: string): Snapshot {
  const horizon = lastForecastSunday(today);
  const { book, spec } = timeline;
  const known = (date: string | undefined) => date !== undefined && date <= today;

  const invoices: Invoice[] = [];
  const shownPlans = new Set<string>();
  for (const i of book.invoices) {
    if (i.issued > today) continue;
    const open = !known(i.paidOn) && !known(i.writtenOffOn);
    const touches = [i.issued, i.paidOn, i.payoutOn, i.writtenOffOn].some(
      (d) => d !== undefined && d >= WINDOW_START && d <= today,
    );
    if (!open && !touches) continue;
    const invoice: Invoice = {
      id: i.id,
      customerId: i.customerId,
      amount: i.amount,
      issued: i.issued,
      due: i.due,
      billingPlanId: i.planId,
    };
    if (known(i.paidOn)) {
      invoice.paid = i.paidOn;
      invoice.paidAmount = i.paidAmount ?? i.amount;
    } else if (known(i.writtenOffOn)) invoice.writtenOff = i.writtenOffOn;
    invoices.push(invoice);
    shownPlans.add(i.planId);
  }

  const billingPlans: BillingPlan[] = [];
  for (const p of book.plans) {
    const active = p.startOn <= today && (p.endDate === undefined || p.endDate >= today);
    if (!shownPlans.has(p.id) && !active) continue;
    const plan: BillingPlan = {
      id: p.id,
      customerId: p.customerId,
      amount: p.amount,
      anchorDate: p.anchor,
      nextInvoiceDate: nextOccurrence(p.anchor, today, p.everyMonths),
      everyMonths: p.everyMonths,
      paymentTermsDays: p.terms,
    };
    if (p.endDate !== undefined && known(p.endKnownOn)) plan.endDate = p.endDate;
    billingPlans.push(plan);
  }

  const planCustomers = new Set(billingPlans.map((p) => p.customerId));
  const customers: Customer[] = book.customers
    .filter((c) => planCustomers.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, paymentTermsDays: c.terms }));

  const deals: Deal[] = [];
  for (const d of book.deals) {
    if (d.openFrom > today || !planCustomers.has(d.customerId)) continue;
    const decided = known(d.decidedOn);
    if (decided && d.closeOn < WINDOW_START && d.decidedOn < WINDOW_START) continue;
    const deal: Deal = {
      id: d.id,
      customerId: d.customerId,
      amount: d.amount,
      stage: !decided ? "open" : d.outcome,
      expectedClose: d.closeOn,
      signed: decided && d.outcome === "won",
      invoiceId: decided && d.outcome === "won" ? (d.invoiceId ?? null) : null,
      kind: d.kind,
    };
    deals.push(deal);
  }

  const pendingPayouts: PendingPayout[] = [];
  // Charges made by today that Stripe has not paid out yet, by arrival day. Weekend charges
  // after today can still join the same deposit, so the deposit may end up larger.
  const byArrival = new Map<string, typeof book.invoices>();
  for (const i of book.invoices)
    if (i.method === "card" && known(i.paidOn) && i.payoutOn! > today)
      byArrival.set(i.payoutOn!, [...(byArrival.get(i.payoutOn!) ?? []), i]);
  for (const [arrival, list] of byArrival)
    pendingPayouts.push({
      id: `po_${arrival}`,
      amount: list.reduce((s, i) => s + (i.net ?? 0), 0),
      expectedArrival: arrival,
      invoiceIds: list.map((i) => i.id),
    });

  const inWindow = (date: string) => date >= WINDOW_START && date <= today;
  return {
    companyId: spec.id,
    asOf: today,
    cashOnHand: timeline.balances.get(today) ?? 0,
    restrictedCash: spec.restrictedCash,
    customers,
    invoices,
    bankTxns: timeline.bankTxns.filter((t) => inWindow(t.date)),
    bills: timeline.bills
      .filter((b) => b.received <= today && b.due <= horizon)
      .filter((b) => b.payOn >= WINDOW_START || b.due >= WINDOW_START)
      .map((b) => ({
        id: b.id,
        vendor: b.vendor,
        amount: b.amount,
        due: b.due,
        ...(known(b.payOn) && { paid: b.payOn }),
        critical: b.critical,
      }))
      .sort((a, b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id)),
    cardTxns: timeline.cards.filter((c) => inWindow(c.date)).map((c) => ({ ...c })),
    payroll: timeline.roster.runs
      .filter((r) => r.date >= WINDOW_START && r.date <= horizon)
      .map((r) => ({ id: r.id, date: r.date, amount: r.amount })),
    deals,
    billingPlans,
    pendingPayouts,
  };
}

/** Timeline end: the 13-week horizon plus slack, so every published record is generated. */
const endFor = (today: string) => addDays(lastForecastSunday(today), 40);

const calibrated = new Map<string, ProfileSpec>();

/**
 * The profile with its seed-calibrated starting cash. Calibration always runs on the
 * creation-week timeline, so every later week of the same seed uses the same start.
 */
export function profileSpec(profile: ProfileId, seed: number): ProfileSpec {
  const base = PROFILES[profile];
  const target = base.lowestUsableAfterCreation;
  if (target === undefined) return base;
  const key = `${profile}:${seed}`;
  const known = calibrated.get(key);
  if (known) return known;
  let spec = base;
  for (let pass = 0; pass < 8; pass++) {
    const timeline = generateTimeline(spec, seed, endFor(TODAY0));
    const low = lowestUsable(timeline, addDays(TODAY0, 1), lastForecastSunday(TODAY0)).usable;
    const gap = target - low;
    if (gap > -1_000_000 && gap < 1_000_000) break;
    spec = { ...spec, startCash: spec.startCash + gap };
  }
  calibrated.set(key, spec);
  return spec;
}

/** Full private timeline for a profile at a week; for tests and evaluation only. */
export function profileTimeline(profile: ProfileId, seed: number, week = WEEK0): Timeline {
  return profileTimelineOn(profile, seed, todayOf(week));
}

/** Full private timeline long enough to cut any day up to `today`'s 13-week horizon. */
export function profileTimelineOn(profile: ProfileId, seed: number, today: string): Timeline {
  return generateTimeline(profileSpec(profile, seed), seed, endFor(today));
}

/**
 * A driver-based company world. companyId is the profile id; WorldState.profile stays the
 * "kestrel" vertical because the contract's profile enum has no scenario values. There is
 * no runtime queue: the world at any week is a pure function of (profile, seed, week).
 */
export function createProfileCompany(profile: ProfileId, seed: number, week = WEEK0): WorldState {
  if (!Number.isInteger(week) || week < WEEK0) throw new Error(`week must be ${WEEK0} or later`);
  return profileWorldOn(profile, seed, todayOf(week));
}

/**
 * The driver-based world on any day from the creation date on, for the day-by-day clock.
 * `week` counts whole weeks since the creation date, so week-aligned days match
 * createProfileCompany exactly. Pure: the same (profile, seed, today) gives the same world.
 */
export function profileWorldOn(profile: ProfileId, seed: number, today: string): WorldState {
  if (!Number.isSafeInteger(seed)) throw new Error("seed must be a safe integer");
  const elapsed = daysBetween(TODAY0, today);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || !(elapsed >= 0))
    throw new Error(`today must be ${TODAY0} or later`);
  const snapshot = cut(profileTimelineOn(profile, seed, today), today);
  return WorldStateSchema.parse({
    companyId: profile,
    profile: "kestrel",
    seed,
    week: WEEK0 + Math.floor(elapsed / 7),
    today,
    snapshot,
    pendingEvents: [],
  });
}

/** Driver-based worlds have a profile companyId and no legacy runtime queue. */
export function isProfileWorld(world: WorldState): boolean {
  return isProfileId(world.companyId) && world.runtime === undefined;
}

/** Seven days later. Scenario changes are not supported on driver-based worlds. */
export function advanceProfileWeek(world: WorldState, injected: unknown[] = []): WorldState {
  if (injected.length > 0)
    throw new Error("advanceProfileWeek: injected changes are not supported on profile worlds");
  return advanceProfileDays(world, 7);
}

/** `days` days later (default one): the simulated clock's step. */
export function advanceProfileDays(world: WorldState, days = 1): WorldState {
  if (!isProfileWorld(world) || !isProfileId(world.companyId))
    throw new Error("advanceProfileDays: not a driver-based profile world");
  if (!Number.isInteger(days) || days < 1) throw new Error("days must be a positive integer");
  return profileWorldOn(world.companyId, world.seed, addDays(world.today, days));
}

/**
 * Bank balance at the start of the first observed week, for statement tie-outs. Uses the
 * creation-week timeline: the late-payer cohort is chosen from billing up to the creation date.
 */
export function profileOpeningCash(profile: ProfileId, seed: number): number {
  return profileTimeline(profile, seed).openingCash;
}
