import type {
  Branch,
  Change,
  CompanyModel,
  Constraint,
  FixCandidate,
  Forecast,
  Invoice,
  RiskEvent,
  Snapshot,
} from "@domino/contracts";
import { engine, rankFixes, scheduledItems } from "@domino/engine";
import { cashSchedule } from "@domino/engine/src/forecast";

/**
 * Field analyst scenarios (pure, deterministic). The analyst picks 6 to 10 stress scenarios
 * from the latest snapshot's real records; each forecaster runs the pure engine forecast,
 * stress test and fix scoring on one of them. Integer cents throughout; nothing here reads the
 * clock, a fixture, the sim answer key or any external API, and nothing moves money.
 */

export type Inputs = { snapshot: Snapshot; model: CompanyModel; constraints: Constraint[] };
export type Scenario = { id: string; title: string; changes: Change[]; basis: string };
export type ForecastWork = {
  weeks: { weekStart: string; usable: number }[];
  baseLow: number;
  low: number;
  /** Worst week of (scenario usable - base usable), cents; 0 or negative. */
  cashImpact: number;
  cashImpactWeek: number;
  lowWeek: number;
  baseSurvives: boolean;
  survives: boolean;
  breaksAt?: string;
  breaksWeek?: number;
  brokenConstraintId?: string;
};
export type FixResult = {
  id: string;
  label: string;
  costNote: string;
  risk: "low" | "medium" | "high";
  gain: number;
  clearsAllRules: boolean;
  survivesWithFix: boolean;
};

export const MIN_SCENARIOS = 6;
export const MAX_SCENARIOS = 10;
const HORIZON_DAYS = 13 * 7;
const MAX_CHANGES = 40;

const DAY_MS = 86_400_000;
export const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** Integer percent of integer cents, floored (stays integer cents). */
const pct = (cents: number, percent: number) => Math.floor((cents * percent) / 100);

/** "$1.2M", "$340K", "-$85K": display only; stored values stay integer cents. */
export function usd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const d = Math.abs(cents) / 100;
  if (d >= 1_000_000) return `${sign}$${(d / 1_000_000).toFixed(d >= 10_000_000 ? 1 : 2)}M`;
  if (d >= 1_000) return `${sign}$${Math.round(d / 1_000)}K`;
  return `${sign}$${Math.round(d)}`;
}

const openInvoices = (s: Snapshot) => {
  const end = addDays(s.asOf, HORIZON_DAYS);
  return s.invoices
    .filter((i) => i.paid === undefined && i.writtenOff === undefined && i.due <= end)
    .sort(byId);
};

/** Customers by open receivables in the horizon (then id); falls back to all invoices. */
function topCustomers(s: Snapshot, n: number): { id: string; name: string; open: Invoice[] }[] {
  const open = openInvoices(s);
  const pool = open.length > 0 ? open : s.invoices;
  const totals = new Map<string, number>();
  for (const i of pool) totals.set(i.customerId, (totals.get(i.customerId) ?? 0) + i.amount);
  const names = new Map(s.customers.map((c) => [c.id, c.name]));
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, n)
    .map(([id]) => ({
      id,
      name: names.get(id) ?? id,
      open: open.filter((i) => i.customerId === id),
    }));
}

const sumIn = <T extends { amount: number }>(rows: T[]) => rows.reduce((n, r) => n + r.amount, 0);

/** Deterministic scenario set from the snapshot's own records, 6 to 10 entries. */
export function pickScenarios(inputs: Inputs): Scenario[] {
  const { snapshot: s, model, constraints } = inputs;
  const out: Scenario[] = [];
  const add = (sc: Scenario) => {
    if (out.length < MAX_SCENARIOS && !out.some((o) => o.id === sc.id)) out.push(sc);
  };
  const top = topCustomers(s, 3);
  const lead = top[0];
  if (lead) {
    const churn: Change = { kind: "churn", customerId: lead.id, fromDate: addDays(s.asOf, 1) };
    const before = cashSchedule(s, model, []);
    const after = cashSchedule(s, model, [churn]);
    const remaining = new Set(
      after.items.filter((item) => item.kind === "invoice").map((item) => item.id),
    );
    // Churn already removes future receipts. Only separately lose overdue invoices it leaves.
    // Omitting redundant changes preserves the engine result and keeps every Timeline step real.
    const changes: Change[] = [
      ...(after.items.length < before.items.length ? [churn] : []),
      ...lead.open
        .slice(0, MAX_CHANGES)
        .filter((invoice) => remaining.has(invoice.id))
        .map((invoice) => ({ kind: "lose_invoice" as const, invoiceId: invoice.id })),
    ];
    add({
      id: "top_customer_leaves",
      title: `${lead.name} leaves`,
      changes,
      basis: `Largest open receivables customer stops billing and paying (${lead.open.length} open invoices, ${usd(sumIn(lead.open))})`,
    });
  }
  for (const days of [30, 60]) {
    // An overdue invoice delayed by fewer days than it is already late would land in the past.
    const late = top
      .flatMap((c) => c.open)
      .filter((i) => addDays(i.due, days) > s.asOf)
      .slice(0, MAX_CHANGES);
    if (late.length === 0) break;
    add({
      id: `top_payers_${days}_late`,
      title: `Top ${top.length} payers pay ${days} days late`,
      changes: late.map((i) => ({ kind: "delay_invoice", invoiceId: i.id, days })),
      basis: `${late.length} open invoices worth ${usd(sumIn(late))} from ${top.map((c) => c.name).join(", ")}`,
    });
  }
  // Vendor cost spike: +20% of the last 90 days' monthly bill run-rate, for three months.
  const since = addDays(s.asOf, -90);
  const recentBills = s.bills.filter((b) => b.due > since && b.due <= s.asOf);
  const monthlyBills = Math.floor(sumIn(recentBills) / 3);
  if (monthlyBills > 0) {
    const extra = pct(monthlyBills, 20);
    add({
      id: "cost_spike",
      title: `Vendor costs jump 20% (${usd(extra)} a month)`,
      changes: [7, 35, 63].map((d) => ({
        kind: "remove_cash",
        date: addDays(s.asOf, d),
        amount: extra,
        label: `Vendor cost spike ${addDays(s.asOf, d)}`,
      })),
      basis: `${recentBills.length} bills in the last 90 days average ${usd(monthlyBills)} a month`,
    });
  }
  // Hiring plan: each future payroll run in the horizon grows by 10% of the recent average.
  const past = s.payroll.filter((p) => p.date <= s.asOf).sort((a, b) => (a.date < b.date ? 1 : -1));
  const recent = past.slice(0, 4);
  const avgRun = recent.length ? Math.floor(sumIn(recent) / recent.length) : 0;
  const end = addDays(s.asOf, HORIZON_DAYS);
  const future = s.payroll.filter((p) => p.date > s.asOf && p.date <= end).sort(byId);
  const runDates = future.length
    ? future.map((p) => p.date)
    : [14, 28, 42, 56, 70, 84].map((d) => addDays(s.asOf, d));
  if (avgRun > 0) {
    const perRun = pct(avgRun, 10);
    add({
      id: "hiring_plan",
      title: `Hiring plan adds 10% to payroll (${usd(perRun)} a run)`,
      changes: runDates.map((date) => ({
        kind: "remove_cash",
        date,
        amount: perRun,
        label: `Planned hires ${date}`,
      })),
      basis: `Average of the last ${recent.length} payroll runs is ${usd(avgRun)}`,
    });
  }
  // Debt service / heaviest payment week: that week's expected collections slip two weeks.
  const items = scheduledItems(s);
  const outByWeek = new Map<string, number>();
  for (const i of items)
    if (i.cents < 0) outByWeek.set(i.dueWeek, (outByWeek.get(i.dueWeek) ?? 0) - i.cents);
  const heavy = [...outByWeek.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  if (heavy) {
    // Collections due that week, else the two weeks before it, slip two weeks.
    const before = addDays(heavy[0], -14);
    const same = items.filter((i) => i.dueWeek === heavy[0] && i.kind === "receivable");
    const slips = (
      same.length
        ? same
        : items.filter(
            (i) => i.kind === "receivable" && i.dueWeek >= before && i.dueWeek < heavy[0],
          )
    )
      // Overdue items (at_risk) slipping two weeks could still land in the past.
      .filter((i) => i.status !== "at_risk")
      .slice(0, MAX_CHANGES);
    if (slips.length)
      add({
        id: "debt_service_week",
        title: `Heaviest payment week (${heavy[0]}, ${usd(heavy[1])} out) with its collections 2 weeks late`,
        changes: slips.map((i) => ({ kind: "delay_invoice", invoiceId: i.sourceRef, days: 14 })),
        basis: `${slips.length} receivables due ${same.length ? "the same week as" : "just before"} ${usd(heavy[1])} of payables and payroll`,
      });
  }
  // Card spend spike: the last 28 days of card spend repeats on top, over the next four weeks.
  const cardSince = addDays(s.asOf, -28);
  const cards = s.cardTxns.filter((c) => c.date > cardSince && c.date <= s.asOf && c.amount > 0);
  const cardSpend = sumIn(cards);
  if (cardSpend > 0) {
    const weekly = Math.floor(cardSpend / 4);
    add({
      id: "card_spend_spike",
      title: `Card spend doubles for 4 weeks (${usd(cardSpend)} extra)`,
      changes: [7, 14, 21, 28].map((d) => ({
        kind: "remove_cash",
        date: addDays(s.asOf, d),
        amount: weekly,
        label: `Card spend spike ${addDays(s.asOf, d)}`,
      })),
      basis: `${cards.length} card charges in the last 28 days total ${usd(cardSpend)}`,
    });
  }
  // Engine-ranked risks fill the rest (scanRisks, probability x impact order).
  const leadOpen = new Set(lead?.open.map((i) => i.id));
  for (const r of engine.scanRisks(s, model, constraints))
    if (!r.changes.every((c) => c.kind === "lose_invoice" && leadOpen.has(c.invoiceId)))
      add({ id: r.id, title: r.label, changes: r.changes, basis: "engine.scanRisks" });
  if (out.length < MIN_SCENARIOS && lead) {
    for (const i of lead.open.slice(0, MIN_SCENARIOS - out.length))
      add({
        id: `lose_${i.id}`,
        title: `${lead.name} never pays invoice ${i.id}`,
        changes: [{ kind: "lose_invoice", invoiceId: i.id }],
        basis: `Open invoice of ${usd(i.amount)} due ${i.due}`,
      });
  }
  return out;
}

const asRisk = (sc: Scenario): RiskEvent => ({
  id: sc.id,
  label: sc.title,
  probability: 1,
  impactLowPoint: 0,
  changes: sc.changes,
  evidence: [],
});

/** Forecast + stress test for one scenario (engine.forecast and engine.stressTest). */
export function forecastScenario(inputs: Inputs, sc: Scenario): ForecastWork {
  const { snapshot, model, constraints } = inputs;
  const base = engine.forecast(snapshot, model, []);
  const scen: Forecast = engine.forecast(snapshot, model, sc.changes);
  const report = engine.stressTest(snapshot, model, constraints, [asRisk(sc)], []);
  const baseU = report.universes.find((u) => u.riskIds.length === 0);
  const u = report.universes.find((x) => x.riskIds.length === 1 && x.riskIds[0] === sc.id);
  const weeks = scen.weeks.map((w) => ({ weekStart: w.weekStart, usable: w.usable }));
  const worst = weeks.reduce(
    (m, w, i) => {
      const delta = w.usable - (base.weeks[i]?.usable ?? w.usable);
      return delta < m.delta ? { delta, week: i + 1 } : m;
    },
    { delta: 0, week: 0 },
  );
  const weekOf = (date: string) => {
    const i = weeks.findIndex((w) => w.weekStart === date);
    return i >= 0 ? i + 1 : undefined;
  };
  const breaksWeek = u?.breaksAt ? weekOf(u.breaksAt) : undefined;
  return {
    weeks,
    baseLow: base.lowPoint.usable,
    low: scen.lowPoint.usable,
    cashImpact: worst.delta,
    cashImpactWeek: worst.week,
    lowWeek: weekOf(scen.lowPoint.weekStart) ?? 0,
    baseSurvives: baseU?.survives ?? true,
    survives: u?.survives ?? true,
    ...(u?.breaksAt && { breaksAt: u.breaksAt }),
    ...(breaksWeek !== undefined && { breaksWeek }),
    ...(u?.brokenConstraintId && { brokenConstraintId: u.brokenConstraintId }),
  };
}

/** Deterministic fix candidates for one scenario, from the snapshot's own records. */
export function fixCandidates(inputs: Inputs, sc: Scenario, work: ForecastWork): FixCandidate[] {
  const { snapshot: s, constraints } = inputs;
  const target = [sc.id];
  const fixes: FixCandidate[] = [];
  const end = addDays(s.asOf, HORIZON_DAYS);
  const holdable = s.bills
    .filter((b) => !b.paid && !b.critical && b.due > s.asOf && b.due <= end)
    .sort(byId)
    .slice(0, MAX_CHANGES);
  if (holdable.length)
    fixes.push({
      id: "fix_hold_bills",
      label: `Hold ${holdable.length} non-critical vendor bills 30 days`,
      changes: holdable.map((b) => ({ kind: "delay_bill", billId: b.id, days: 30 })),
      costNote: `Defers ${usd(sumIn(holdable))} of bills; vendors may charge late fees`,
      risk: "medium",
      evidence: [],
      targetRiskIds: target,
    });
  const early = openInvoices(s)
    .filter((i) => i.due > addDays(s.asOf, 14) && !i.collection)
    .sort((a, b) => b.amount - a.amount || byId(a, b))[0];
  if (early) {
    const name = s.customers.find((c) => c.id === early.customerId)?.name ?? early.customerId;
    fixes.push({
      id: "fix_early_pay",
      label: `Offer ${name} 2% to pay ${usd(early.amount)} now`,
      changes: [
        {
          kind: "discount_early_pay",
          invoiceId: early.id,
          percent: 2,
          payOn: addDays(s.asOf, 7),
        },
      ],
      costNote: `Gives up ${usd(pct(early.amount, 2))} of invoice ${early.id}`,
      risk: "low",
      evidence: [],
      targetRiskIds: target,
    });
  }
  const hires = sc.changes.filter(
    (c) =>
      c.kind === "remove_cash" &&
      (c.label === "Planned hires" || c.label.startsWith("Planned hires ")),
  );
  const perRun = hires[0]?.kind === "remove_cash" ? hires[0].amount : 0;
  if (perRun > 0)
    fixes.push({
      id: "fix_pause_hiring",
      label: "Pause the hiring plan for the quarter",
      changes: [
        {
          kind: "shift_hire",
          label: "Paused hires",
          monthlyCost: perRun * 2,
          fromDate: addDays(s.asOf, 1),
          toDate: end,
        },
      ],
      costNote: "Slower growth: planned hires start next quarter",
      risk: "low",
      evidence: [],
      targetRiskIds: target,
    });
  const floor = constraints.find((c) => c.kind === "min_cash")?.limit ?? 0;
  if (!work.survives && work.low < floor) {
    const need = Math.ceil((floor - work.low) / 5_000_000) * 5_000_000;
    const date = work.breaksAt ? addDays(work.breaksAt, -7) : addDays(s.asOf, 7);
    fixes.push({
      id: "fix_bridge",
      label: `Raise a ${usd(need)} bridge before week ${work.breaksWeek ?? 1}`,
      changes: [
        {
          kind: "add_cash",
          date: date > s.asOf ? date : addDays(s.asOf, 1),
          amount: need,
          label: "Bridge financing",
        },
      ],
      costNote: `Covers the ${usd(floor - work.low)} gap to the cash minimum; dilution or interest`,
      risk: "high",
      evidence: [],
      targetRiskIds: target,
    });
  }
  return fixes;
}

/** engine.scoreFix each candidate under the scenario, engine.rankFixes, then re-stress the best. */
export function scoreFixes(
  inputs: Inputs,
  sc: Scenario,
  work: ForecastWork,
): { tried: number; ranked: FixResult[] } {
  const { snapshot, model, constraints } = inputs;
  const candidates = fixCandidates(inputs, sc, work);
  const parent: Branch = {
    id: `scn_${sc.id}`,
    parentId: null,
    kind: "event",
    label: sc.title,
    probability: 1,
    changes: sc.changes,
    forecast: engine.forecast(snapshot, model, sc.changes),
    dominoes: [],
    status: "draft",
    riskIds: [sc.id],
  };
  const scored = candidates.map((fix) => ({
    fix,
    branch: engine.scoreFix(parent, fix, snapshot, model, constraints),
  }));
  const ranked = rankFixes(parent, scored, snapshot, model, constraints).slice(0, 3);
  const results = ranked.map((r) => {
    const report = engine.stressTest(snapshot, model, constraints, [asRisk(sc)], [r.fix]);
    const u = report.universes.find((x) => x.riskIds.length === 1);
    return {
      id: r.fix.id,
      label: r.fix.label,
      costNote: r.fix.costNote,
      risk: r.fix.risk,
      gain: r.gain,
      clearsAllRules: r.clearsAllRules,
      survivesWithFix: u?.survives ?? false,
    };
  });
  // Best = a fix that makes the scenario survive, the lowest risk first; then engine order.
  const RISK = { low: 0, medium: 1, high: 2 } as const;
  const order = (f: FixResult) => (f.survivesWithFix ? RISK[f.risk] : 3);
  return {
    tried: candidates.length,
    ranked: results
      .map((f, i) => ({ f, i }))
      .sort((a, b) => order(a.f) - order(b.f) || a.i - b.i)
      .map(({ f }) => f),
  };
}

/** Three observable progress chunks over the 13 weeks. */
export const WEEK_CHUNKS = [
  [1, 4],
  [5, 8],
  [9, 13],
] as const;

export function chunkSummary(work: ForecastWork, chunk: number): string {
  const [from, to] = WEEK_CHUNKS[chunk] ?? [1, 13];
  const seen = work.weeks.slice(0, to);
  const lowest = seen.reduce(
    (m, w, i) => (w.usable < m.usable ? { usable: w.usable, week: i + 1 } : m),
    { usable: Number.POSITIVE_INFINITY, week: 0 },
  );
  const last = work.weeks[to - 1];
  const breach =
    work.breaksWeek !== undefined && work.breaksWeek >= from && work.breaksWeek <= to
      ? `; breaks ${work.brokenConstraintId ?? "a rule"} in week ${work.breaksWeek}`
      : "";
  return `Weeks ${from}-${to}: usable ${usd(last?.usable ?? 0)} at week ${to}, lowest so far ${usd(lowest.usable)} (week ${lowest.week})${breach}`;
}

export function outcomeText(work: ForecastWork): string {
  return work.survives
    ? `survives; low ${usd(work.low)} in week ${work.lowWeek}`
    : `fails in week ${work.breaksWeek ?? "?"} (${work.brokenConstraintId ?? "rule"}); low ${usd(work.low)}`;
}
