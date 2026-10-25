import type { BankTxn, Bill, Invoice, Snapshot } from "@domino/contracts";
import type { ProfileId } from "@domino/sim";
import { money, rankCustomers } from "./judge";

/**
 * Storylines (pure, no Convex functions): deterministic scripted events per company profile,
 * keyed by simulated day (days since the clock's start). The simulated clock (fieldClock.ts)
 * fires a beat on its day: the beat is resolved against what the mock sources serve then and
 * stored on the feed overlay, and from that moment the mock vendor APIs report its effect. The
 * agents only ever see those source responses, never this script.
 *
 * Effects stay coherent as time moves on: a lost customer's later invoices and their bank
 * payments disappear, a disputed invoice is paid at its agreed share, slipped payments land
 * later, and the bank balance moves by exactly the bank lines that changed, so every tie-out
 * still agrees to the cent. Money is integer cents; shares are basis points rounded half up.
 */

export type BeatKind = "customer_notice" | "payers_slip" | "bonus_payroll" | "duplicate_bill";

export type Beat = {
  /** Stable id within the profile, e.g. "osprey-notice". */
  id: string;
  /** Simulated day it fires on (1 = the day after the clock started). */
  day: number;
  title: string;
} & (
  | {
      kind: "customer_notice";
      /** Who gives notice; default the largest ACH customer by billing plus what it owes. */
      customerId?: string;
      /** Share of the largest open invoice it agrees to pay, in basis points. */
      settleBps: number;
      /** Days from the notice to the settlement when that invoice is already due. */
      payInDays: number;
    }
  | { kind: "payers_slip"; count: number; days: number }
  | { kind: "bonus_payroll"; bps: number; payInDays: number }
  | { kind: "duplicate_bill" }
);

export const STORYLINES: Record<ProfileId, Beat[]> = {
  kestrel: [
    {
      id: "kestrel-duplicate",
      day: 11,
      kind: "duplicate_bill",
      title: "The books re-send an upcoming bill",
    },
  ],
  "kestrel-churn": [
    {
      id: "harrier-notice",
      day: 6,
      kind: "customer_notice",
      customerId: "cus_halcyon",
      settleBps: 6_000,
      payInDays: 15,
      title: "Halcyon Freight's churn notice and settlement terms",
    },
  ],
  "kestrel-late": [
    {
      id: "merlin-slip",
      day: 4,
      kind: "payers_slip",
      count: 3,
      days: 30,
      title: "The biggest payers slip 30 days",
    },
  ],
  "kestrel-crunch": [
    {
      id: "osprey-notice",
      day: 9,
      kind: "customer_notice",
      settleBps: 6_000,
      payInDays: 14,
      title: "The top customer gives notice",
    },
    {
      id: "osprey-bonus",
      day: 15,
      kind: "bonus_payroll",
      bps: 15_000,
      payInDays: 5,
      title: "A retention bonus payroll is approved",
    },
  ],
};

/** A beat as it fired: what it resolved to on its day. Stored on the feed overlay. */
export type Fired = {
  beatId: string;
  day: number;
  date: string;
  title: string;
  summary: string;
} & (
  | {
      kind: "customer_notice";
      customerId: string;
      invoiceId: string | null;
      settleBps: number;
      payOn: string | null;
    }
  | { kind: "payers_slip"; customerIds: string[]; days: number }
  | { kind: "bonus_payroll"; runId: string; payOn: string; amount: number }
  | { kind: "duplicate_bill"; billId: string; copyId: string }
);

export interface StoryState {
  fired: Fired[];
}

const DAY_MS = 86_400_000;
export const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
const later = (a: string, b: string) => (a > b ? a : b);
/** Weekends roll to Monday (bank holidays are not modelled here). */
function businessDay(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dow === 6 ? addDays(date, 2) : dow === 0 ? addDays(date, 1) : date;
}
/** cents x bps / 10,000, rounded half up. Integer math only. */
const share = (cents: number, bps: number) => Math.floor((cents * bps + 5_000) / 10_000);
const isOpen = (i: Invoice) => i.paid === undefined && i.writtenOff === undefined;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Customer ids with ACH payments on the bank feed (bank ids `bank_ach_<customer>_<date>`). */
function achCustomers(s: Snapshot): Set<string> {
  const out = new Set<string>();
  for (const t of s.bankTxns)
    if (t.id.startsWith("bank_ach_") && t.id.length > 20) out.add(t.id.slice(9, -11));
  return out;
}

export const beatsFor = (profile: ProfileId | null): Beat[] =>
  profile ? [...STORYLINES[profile]].sort((a, b) => a.day - b.day) : [];

/** The next beat that has not fired, by day; null when the storyline is done. */
export function nextBeat(profile: ProfileId | null, story: StoryState | undefined): Beat | null {
  const fired = new Set((story?.fired ?? []).map((f) => f.beatId));
  return beatsFor(profile).find((b) => !fired.has(b.id)) ?? null;
}

/** Beats due on or before `day` that have not fired yet, in day order. */
export function dueBeats(profile: ProfileId | null, story: StoryState | undefined, day: number) {
  const fired = new Set((story?.fired ?? []).map((f) => f.beatId));
  return beatsFor(profile).filter((b) => b.day <= day && !fired.has(b.id));
}

const fail = (message: string): never => {
  throw new Error(message);
};

/**
 * Resolve one beat against what the sources serve on its day. Returns the fired record and,
 * for a re-sent bill, the extra bill the books now report (it goes on the feed overlay).
 * Deterministic: the same served snapshot gives the same result.
 */
export function resolveBeat(
  served: Snapshot,
  beat: Beat,
  day: number,
): { fired: Fired; bills: Bill[] } {
  const date = served.asOf;
  const base = { beatId: beat.id, day, date, title: beat.title };
  const names = new Map(served.customers.map((c) => [c.id, c.name]));
  const ach = achCustomers(served);
  switch (beat.kind) {
    case "customer_notice": {
      const ranked = rankCustomers(served, 50).filter((c) => ach.has(c.id));
      const customerId =
        beat.customerId ?? ranked[0]?.id ?? fail("No customer pays by ACH to give notice");
      const name = names.get(customerId) ?? customerId;
      const open = served.invoices
        .filter((i) => i.customerId === customerId && isOpen(i))
        .sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));
      const invoice = open[0];
      const payOn = invoice
        ? businessDay(invoice.due > date ? invoice.due : addDays(date, beat.payInDays))
        : null;
      const yearly = (served.billingPlans ?? [])
        .filter((p) => p.customerId === customerId && (p.endDate === undefined || p.endDate > date))
        .reduce((n, p) => n + Math.round((p.amount * 12) / p.everyMonths), 0);
      const dispute = invoice
        ? `; it disputes invoice ${invoice.id} (${money(invoice.amount)}) and will pay ${beat.settleBps / 100}% (${money(share(invoice.amount, beat.settleBps))}) on ${payOn}`
        : "";
      return {
        fired: {
          ...base,
          kind: "customer_notice",
          customerId,
          invoiceId: invoice?.id ?? null,
          settleBps: beat.settleBps,
          payOn,
          summary: `${name} gives notice: no renewal, billing ends ${date}${yearly > 0 ? ` (${money(yearly)} a year)` : ""}${dispute}`,
        },
        bills: [],
      };
    }
    case "payers_slip": {
      const owed = rankCustomers(served, 200)
        .filter((c) => ach.has(c.id) && c.openCents > 0)
        .sort((a, b) => b.openCents - a.openCents || a.id.localeCompare(b.id))
        .slice(0, beat.count);
      if (owed.length === 0) fail("No ACH customer owes anything to slip");
      const total = owed.reduce((n, c) => n + c.openCents, 0);
      return {
        fired: {
          ...base,
          kind: "payers_slip",
          customerIds: owed.map((c) => c.id),
          days: beat.days,
          summary: `${owed.map((c) => c.name).join(", ")} say their AP moved: ${money(total)} of open invoices and every new one will be paid ${beat.days} days later`,
        },
        bills: [],
      };
    }
    case "bonus_payroll": {
      const runs = [...served.payroll].map((r) => r.amount).sort((a, b) => a - b);
      const median = runs[runs.length >> 1] ?? fail("No payroll runs to base a bonus on");
      // Whole dollars, so the bonus reads as a number someone approved.
      const amount = Math.floor(share(median, beat.bps) / 100) * 100;
      const payOn = businessDay(addDays(date, beat.payInDays));
      const runId = `pay_bonus_${payOn}`;
      return {
        fired: {
          ...base,
          kind: "bonus_payroll",
          runId,
          payOn,
          amount,
          summary: `Payroll scheduled a one-off retention bonus run ${runId}: ${money(amount)} on ${payOn}`,
        },
        bills: [],
      };
    }
    case "duplicate_bill": {
      const bill =
        [...served.bills]
          .filter((b) => !b.paid && b.due > date)
          .sort((a, b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id))[0] ??
        fail("No upcoming bill for the books to re-send");
      const copyId = `${bill.id}_resent`;
      return {
        fired: {
          ...base,
          kind: "duplicate_bill",
          billId: bill.id,
          copyId,
          summary: `The books now show ${bill.vendor}'s bill ${bill.id} (${money(bill.amount)} due ${bill.due}) twice, as ${copyId}`,
        },
        bills: [{ ...bill, id: copyId }],
      };
    }
  }
}

/**
 * The snapshot the sources report once these beats fired. `s` is the world's own snapshot;
 * cashOnHand moves by exactly the bank lines that were added, dropped or changed.
 */
export function applyStory<S extends Snapshot>(s: S, story: StoryState | undefined): S {
  const fired = story?.fired ?? [];
  if (fired.length === 0) return s;
  const world = new Map(s.invoices.map((i) => [i.id, i]));
  let invoices = s.invoices.map((i) => ({ ...i }));
  let plans = s.billingPlans?.map((p) => ({ ...p }));
  let deals = s.deals.map((d) => ({ ...d }));
  const payroll = s.payroll.map((r) => ({ ...r }));
  const extraBank: BankTxn[] = [];
  /** Customer -> first day its ACH payments may differ from the world's. */
  const rebuilt = new Map<string, string>();
  const mark = (customerId: string, from: string) => {
    const prev = rebuilt.get(customerId);
    if (!prev || from < prev) rebuilt.set(customerId, from);
  };

  for (const f of fired)
    switch (f.kind) {
      case "customer_notice": {
        const dropped = new Set(
          invoices
            .filter((i) => i.customerId === f.customerId && i.issued > f.date)
            .map((i) => i.id),
        );
        invoices = invoices
          .filter((i) => !dropped.has(i.id))
          .map((i) => {
            if (i.id !== f.invoiceId) return i;
            const agreed = share(i.amount, f.settleBps);
            if (i.paid === undefined)
              return i.writtenOff === undefined && f.payOn
                ? { ...i, collection: { payOn: f.payOn, amount: agreed } }
                : i;
            return { ...i, paidAmount: Math.min(i.paidAmount ?? i.amount, agreed) };
          });
        plans = plans?.map((p) =>
          p.customerId === f.customerId && (p.endDate === undefined || p.endDate > f.date)
            ? { ...p, endDate: f.date }
            : p,
        );
        deals = deals
          .filter((d) => !(d.invoiceId && dropped.has(d.invoiceId)))
          .map((d) =>
            d.customerId === f.customerId && d.stage === "open"
              ? { ...d, stage: "lost" as const }
              : d,
          );
        mark(f.customerId, f.date);
        break;
      }
      case "payers_slip": {
        const who = new Set(f.customerIds);
        invoices = invoices.map((i) => {
          if (!who.has(i.customerId)) return i;
          // Invoices issued from the notice on carry the longer terms from the start.
          if (i.issued >= f.date) {
            const next = { ...i, due: addDays(i.due, f.days) };
            return shiftPayment(next, f.days, s.asOf);
          }
          if (i.writtenOff !== undefined) return i;
          if (i.paid !== undefined && i.paid < f.date) return i;
          const payOn = addDays(later(i.due, f.date), f.days);
          const next = shiftPayment(i, f.days, s.asOf);
          return next.paid === undefined
            ? { ...next, collection: { payOn, amount: next.collection?.amount ?? next.amount } }
            : next;
        });
        plans = plans?.map((p) =>
          who.has(p.customerId) ? { ...p, paymentTermsDays: p.paymentTermsDays + f.days } : p,
        );
        for (const id of who) mark(id, f.date);
        break;
      }
      case "bonus_payroll": {
        if (!payroll.some((r) => r.id === f.runId))
          payroll.push({ id: f.runId, date: f.payOn, amount: f.amount });
        if (f.payOn <= s.asOf)
          extraBank.push({
            id: `bank_${f.runId}`,
            date: f.payOn,
            amount: -f.amount,
            description: `GUSTO PAYROLL BONUS ${f.runId}`,
            counterparty: "Gusto",
          });
        break;
      }
      case "duplicate_bill":
        break; // The copy is a planted bill on the feed overlay; books only, never paid.
    }

  // Rebuild the affected customers' ACH credits from the reported invoices.
  const served = new Map(invoices.map((i) => [i.id, i]));
  const kept: BankTxn[] = [];
  const credits = new Map<string, { txn: BankTxn; ids: string[] }>();
  let delta = 0;
  for (const t of s.bankTxns) {
    const customerId = t.id.startsWith("bank_ach_") ? t.id.slice(9, -11) : "";
    const from = rebuilt.get(customerId);
    const ids = t.description.split(/\s+/).filter((w) => w.startsWith("inv_"));
    if (!from || t.date < from || ids.some((id) => !world.has(id))) {
      kept.push(t);
      continue;
    }
    delta -= t.amount;
    const name = t.counterparty ?? customerId;
    for (const id of ids) {
      const i = served.get(id);
      if (!i?.paid || i.paid > s.asOf) continue;
      const key = `bank_ach_${customerId}_${i.paid}`;
      const prev = credits.get(key);
      const listed = [...(prev?.ids ?? []), id];
      credits.set(key, {
        ids: listed,
        txn: {
          id: key,
          date: i.paid,
          amount: (prev?.txn.amount ?? 0) + (i.paidAmount ?? i.amount),
          description: `ACH CREDIT customer payment ${listed.join(" ")} ${name}`,
          ...(t.counterparty && { counterparty: t.counterparty }),
        },
      });
    }
  }
  const added = [...[...credits.values()].map((c) => c.txn), ...extraBank].filter(
    (t) => t.amount !== 0,
  );
  for (const t of added) delta += t.amount;
  const bankTxns = [...kept, ...added].sort((a, b) => a.date.localeCompare(b.date));
  return {
    ...s,
    cashOnHand: s.cashOnHand + delta,
    invoices,
    deals,
    payroll: payroll.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
    bankTxns,
    ...(plans && { billingPlans: plans }),
  };
}

/** Moves a world payment `days` later; one that now lands after today is still open. */
function shiftPayment(i: Invoice, days: number, asOf: string): Invoice {
  if (i.paid === undefined) return i;
  const moved = addDays(i.paid, days);
  if (moved <= asOf) return { ...i, paid: moved };
  const { paid: _paid, paidAmount: _amount, ...open } = i;
  return open;
}

/** Plain words for one beat that has not fired, for the clock bar's tooltip. */
export const beatLabel = (beat: Beat) => `Day ${beat.day}: ${beat.title}`;

export const storyCount = (story: StoryState | undefined) =>
  plural(story?.fired.length ?? 0, "scripted event");
