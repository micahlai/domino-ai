import {
  type BankTxn,
  type Bill,
  type CardTxn,
  type Snapshot,
  SnapshotSchema,
  type WorldState,
} from "@domino/contracts";
import {
  type ProfileId,
  advanceProfileWeek,
  createProfileCompany,
  isProfileWorld,
  simulator,
} from "@domino/sim";
import { fieldCompany } from "./lib/fieldCompanies";

/**
 * Field mock feed (pure, no Convex functions). The feed is a private sim WorldState plus an
 * overlay of planted entries. Only servedSnapshot() crosses into the mock source handler, so
 * ingestion sees source-shaped responses, never the world or the overlay. Synthetic only.
 */
export interface Overlay {
  bills: Bill[];
  cardTxns: CardTxn[];
  bankTxns: BankTxn[];
  /** Source-side rewrites of an existing invoice's original amount (a planted conflict). */
  invoiceAmounts: { id: string; amount: number }[];
  /** Payroll runs the payroll source stops reporting (a planted missing item). */
  hiddenPayroll: string[];
}

export const ANOMALIES = [
  "duplicate",
  "unusual_amount",
  "unusual_timing",
  "conflict",
  "missing_expected",
] as const;
export type Anomaly = (typeof ANOMALIES)[number];

export const emptyOverlay = (): Overlay => ({
  bills: [],
  cardTxns: [],
  bankTxns: [],
  invoiceAmounts: [],
  hiddenPayroll: [],
});

/** Convex stores plain JSON: drop undefined fields the sim leaves on records. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** No profile: the legacy Kestrel world. A profile id: the driver-based company for it. */
export function newWorld(seed: number, profile?: ProfileId): WorldState {
  return plain(
    profile ? createProfileCompany(profile, seed) : simulator.createCompany("kestrel", seed),
  );
}

export function nextWorld(world: WorldState): WorldState {
  return plain(
    isProfileWorld(world) ? advanceProfileWeek(world) : simulator.advanceWeek(world, []),
  );
}

/** A profile company is named exactly as in the picker; the legacy world keeps its old name. */
export const profileName = (profile?: ProfileId) =>
  profile ? fieldCompany(profile).name : "Kestrel Data (live feed)";

/** The observable snapshot the mock sources serve: world snapshot with the overlay applied. */
export function servedSnapshot(world: WorldState, overlay: Overlay): Snapshot {
  const s = world.snapshot;
  const amounts = new Map(overlay.invoiceAmounts.map((p) => [p.id, p.amount]));
  const hidden = new Set(overlay.hiddenPayroll);
  return SnapshotSchema.parse({
    ...s,
    invoices: s.invoices.map((i) => (amounts.has(i.id) ? { ...i, amount: amounts.get(i.id) } : i)),
    bills: [...s.bills, ...overlay.bills],
    cardTxns: [...s.cardTxns, ...overlay.cardTxns],
    bankTxns: [...s.bankTxns, ...overlay.bankTxns],
    payroll: s.payroll.filter((p) => !hidden.has(p.id)),
  });
}

const byDate = <T extends { date: string }>(xs: T[]) =>
  [...xs].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const fail = (message: string): never => {
  throw new Error(message);
};

function mostFrequent<T>(xs: T[], key: (x: T) => string): T[] {
  const groups = new Map<string, T[]>();
  for (const x of xs) groups.set(key(x), [...(groups.get(key(x)) ?? []), x]);
  return [...groups.values()].sort((a, b) => b.length - a.length)[0] ?? [];
}

/**
 * Plant one synthetic anomaly in the overlay, derived only from the served data so the demo
 * is repeatable. Returns the new overlay and the planted record ids.
 */
export function plant(
  world: WorldState,
  overlay: Overlay,
  kind: Anomaly,
): { overlay: Overlay; refs: string[]; summary: string } {
  const s = servedSnapshot(world, overlay);
  const tag = `w${world.week}`;
  const ids = new Set(
    [s.invoices, s.bills, s.bankTxns, s.cardTxns, s.payroll].flatMap((l) => l.map((r) => r.id)),
  );
  const fresh = (id: string) => (ids.has(id) ? fail(`${id} is already planted this week`) : id);
  const next = plain(overlay);
  switch (kind) {
    case "duplicate": {
      const bill =
        [...s.bills]
          .filter((b) => !b.paid && b.due > s.asOf)
          .sort((a, b) => (a.due < b.due ? -1 : 1))[0] ?? fail("no upcoming bill to duplicate");
      const id = fresh(`${bill.id}_dup_${tag}`);
      next.bills.push({ ...bill, id });
      return {
        overlay: next,
        refs: [bill.id, id],
        summary: `Books re-sent bill ${bill.id} as ${id}`,
      };
    }
    case "unusual_amount": {
      const series = byDate(mostFrequent(s.cardTxns, (t) => t.merchant));
      const last = series.at(-1);
      if (!last || series.length < 3) return fail("no card spending history to compare against");
      const id = fresh(`card_spike_${tag}`);
      next.cardTxns.push({ ...last, id, date: s.asOf, amount: last.amount * 12 });
      return {
        overlay: next,
        refs: [id],
        summary: `Card charge ${id} at ${last.merchant}, 12x usual`,
      };
    }
    case "unusual_timing": {
      const outflows = s.bankTxns.filter((t) => t.amount < 0);
      const last = byDate(mostFrequent(outflows, (t) => t.counterparty ?? t.description)).at(-1);
      if (!last) return fail("no bank withdrawals to backdate");
      const id = fresh(`bank_late_${tag}`);
      next.bankTxns.push({ ...last, id, date: addDays(s.asOf, -31) });
      return { overlay: next, refs: [id], summary: `Bank posted ${id} dated a month ago` };
    }
    case "conflict": {
      const linked = new Set(s.deals.map((d) => d.invoiceId));
      const done = new Set(overlay.invoiceAmounts.map((p) => p.id));
      const invoice =
        s.invoices.find(
          (i) => !i.paid && !i.writtenOff && !i.collection && !linked.has(i.id) && !done.has(i.id),
        ) ?? fail("no open invoice the billing source could rewrite");
      next.invoiceAmounts.push({ id: invoice.id, amount: invoice.amount + 100_000 });
      return {
        overlay: next,
        refs: [invoice.id],
        summary: `Billing now reports invoice ${invoice.id} $1,000 higher`,
      };
    }
    case "missing_expected": {
      const run =
        byDate(s.payroll).find((p) => p.date > s.asOf) ?? fail("no upcoming payroll run to drop");
      next.hiddenPayroll.push(run.id);
      return { overlay: next, refs: [run.id], summary: `Payroll stopped reporting run ${run.id}` };
    }
  }
}
