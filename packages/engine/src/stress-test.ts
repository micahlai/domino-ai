import type {
  BreakingPoint,
  Change,
  CompanyModel,
  Constraint,
  FixCandidate,
  ResilienceReport,
  RiskEvent,
  Snapshot,
  Universe,
} from "@domino/contracts";
import { daysBetween, horizonEnd } from "./dates";
import { money } from "./dominoes";
import { type CashSchedule, cashSchedule, forecastFromSchedule } from "./forecast";
import { compareIds } from "./funding";
import { compareRisks } from "./risks";
import { type RuleBreach, compareBreaches, evaluateOnSchedule } from "./rules";
import type { CashItem } from "./schedule";

const PAIR_POOL = 4;

/**
 * Build-spec §6.6. Universes: base, each risk, each pair of the top four ranked risks, and all
 * adverse risks together, deduplicated by sorted risk-ID set. Risks are ranked by probability ×
 * impact recomputed through forecast here (the input impactLowPoint is not trusted); adverse
 * means that recomputed impact is positive. Selected fixes apply in caller order, once, to each
 * universe they target ([] = every universe). Survival is the shared min_cash/pay_by_date
 * evaluator; runway does not decide survival. survivalRate is a weighted index over overlapping
 * scenarios (base weight 1, others the product of their risks' chances), not a probability.
 */
export function stressTest(
  snapshot: Snapshot,
  model: CompanyModel,
  constraints: Constraint[],
  risks: RiskEvent[],
  fixes: FixCandidate[],
): ResilienceReport {
  checkInputs(risks, fixes);
  const ranked = rankByComputedImpact(snapshot, model, risks);
  const universes = riskSets(ranked).map((ids) =>
    universe(snapshot, model, constraints, ids, risks, fixes),
  );
  const total = universes.reduce((s, u) => s + u.probability, 0);
  const surviving = universes.filter((u) => u.survives);
  const weight = surviving.reduce((s, u) => s + u.probability, 0);
  return {
    universes,
    survivalRate: Math.min(1, weight / total),
    survivedCount: surviving.length,
    breakingPoints: breakingPoints(snapshot, model, constraints, ranked),
    appliedFixIds: fixes.map((f) => f.id),
  };
}

function checkInputs(risks: RiskEvent[], fixes: FixCandidate[]) {
  const riskIds = new Set<string>();
  for (const r of risks) {
    if (riskIds.has(r.id)) throw new Error(`duplicate risk id ${r.id}`);
    riskIds.add(r.id);
  }
  const fixIds = new Set<string>();
  for (const f of fixes) {
    if (fixIds.has(f.id)) throw new Error(`duplicate fix id ${f.id}`);
    fixIds.add(f.id);
    if (!f.targetRiskIds) {
      throw new Error(`fix ${f.id} has no targetRiskIds: say which risks it targets ([] = all)`);
    }
    for (const t of f.targetRiskIds) {
      if (!riskIds.has(t)) throw new Error(`fix ${f.id} targets unknown risk ${t}`);
    }
  }
}

function rankByComputedImpact(snapshot: Snapshot, model: CompanyModel, risks: RiskEvent[]) {
  const baseLow = forecastFromSchedule(snapshot, cashSchedule(snapshot, model, [])).lowPoint.usable;
  return risks
    .map((r) => {
      const low = forecastFromSchedule(snapshot, cashSchedule(snapshot, model, r.changes)).lowPoint;
      return { ...r, impactLowPoint: baseLow - low.usable };
    })
    .sort(compareRisks);
}

/** Canonical sorted risk-ID sets in generation order, each once. */
function riskSets(ranked: RiskEvent[]): string[][] {
  const top = ranked.slice(0, PAIR_POOL).map((r) => r.id);
  const pairs = top.flatMap((a, i) => top.slice(i + 1).map((b) => [a, b]));
  const adverse = ranked.filter((r) => r.impactLowPoint > 0).map((r) => r.id);
  const sets = [[], ...ranked.map((r) => [r.id]), ...pairs, ...(adverse.length ? [adverse] : [])];
  const seen = new Set<string>();
  return sets.flatMap((set) => {
    const ids = [...set].sort(compareIds);
    const key = JSON.stringify(ids);
    if (seen.has(key)) return [];
    seen.add(key);
    return [ids];
  });
}

function universe(
  snapshot: Snapshot,
  model: CompanyModel,
  constraints: Constraint[],
  ids: string[],
  risks: RiskEvent[],
  fixes: FixCandidate[],
): Universe {
  const chosen = ids.map((id) => risks.find((r) => r.id === id) as RiskEvent);
  const applied = fixes.filter(
    (f) => f.targetRiskIds?.length === 0 || f.targetRiskIds?.some((t) => ids.includes(t)),
  );
  const changes = [...chosen.flatMap((r) => r.changes), ...applied.flatMap((f) => f.changes)];
  const schedule = cashSchedule(snapshot, model, changes);
  const forecast = forecastFromSchedule(snapshot, schedule);
  const breach = survivalBreach(snapshot, constraints, schedule);
  return {
    // JSON of the canonical sorted array: injective for any IDs (including "base" and "a+b"),
    // covers the empty set, and is stable when fixes toggle.
    id: `u_${JSON.stringify(ids)}`,
    label: ids.length ? chosen.map((r) => r.label).join(" + ") : "Base forecast",
    riskIds: ids,
    fixIds: applied.map((f) => f.id),
    probability: chosen.reduce((p, r) => p * r.probability, 1),
    survives: !breach,
    ...(breach ? { breaksAt: breach.weekStart, brokenConstraintId: breach.constraintId } : {}),
    forecast,
  };
}

/** Earliest min_cash or pay_by_date breach (date, then constraint ID), from the shared evaluator. */
export function survivalBreach(
  snapshot: Snapshot,
  constraints: Constraint[],
  schedule: CashSchedule,
): RuleBreach | undefined {
  const forecast = forecastFromSchedule(snapshot, schedule);
  return evaluateOnSchedule(snapshot, forecast, constraints, schedule)
    .flatMap((r) => (r.breach && r.breach.kind !== "min_runway_months" ? [r.breach] : []))
    .sort(compareBreaches)[0];
}

// ---------- Breaking points (sensitivity on the no-fix base) ----------

function breakingPoints(
  snapshot: Snapshot,
  model: CompanyModel,
  constraints: Constraint[],
  ranked: RiskEvent[],
): BreakingPoint[] {
  const base = cashSchedule(snapshot, model, []);
  if (survivalBreach(snapshot, constraints, base)) return [];
  return [
    ...delayPoint(snapshot, model, constraints, ranked, base),
    ...lossPoint(snapshot, model, constraints, base),
  ];
}

/** Smallest x in [0, hi] where `fails` holds, for a monotone predicate with fails(0) false. */
export function smallestFailing(hi: number, fails: (x: number) => boolean): number | undefined {
  if (hi < 0 || !fails(hi)) return undefined;
  let lo = 0;
  let top = hi;
  while (lo < top) {
    const mid = lo + Math.floor((top - lo) / 2);
    if (fails(mid)) top = mid;
    else lo = mid + 1;
  }
  return lo;
}

const invoiceItem = (schedule: CashSchedule, id: string) =>
  schedule.items.find((i) => i.kind === "invoice" && i.id === id);

/**
 * The highest-ranked risk with exactly one delay_invoice change for an open invoice whose
 * unmodified receipt is inside the horizon. Searches extra days from 0 through the first day the
 * receipt leaves the horizon; reports total lateness including the model's rounded mean.
 */
function delayPoint(
  snapshot: Snapshot,
  model: CompanyModel,
  constraints: Constraint[],
  ranked: RiskEvent[],
  base: CashSchedule,
): BreakingPoint[] {
  const end = horizonEnd(base.weeks);
  const pick = ranked.flatMap((r) => {
    const delays = r.changes.filter((c) => c.kind === "delay_invoice");
    const item = delays.length === 1 ? invoiceItem(base, delays[0]?.invoiceId ?? "") : undefined;
    return item && item.date <= end ? [item] : [];
  })[0];
  if (!pick) return [];
  const fails = (days: number) => delayFails(snapshot, model, constraints, pick.id, days);
  const extra = smallestFailing(daysBetween(pick.date, end) + 1, fails);
  if (extra === undefined) return [];
  const mean = Math.round(model.customerDelayDays[pick.customerId ?? ""]?.mean ?? 0);
  const total = mean + extra;
  const name = snapshot.customers.find((c) => c.id === pick.customerId)?.name ?? pick.customerId;
  return [
    { label: `${name} paying ${total} or more days late`, threshold: total, unit: "days_late" },
  ];
}

export function delayFails(
  snapshot: Snapshot,
  model: CompanyModel,
  constraints: Constraint[],
  invoiceId: string,
  days: number,
): boolean {
  const change: Change = { kind: "delay_invoice", invoiceId, days };
  return (
    survivalBreach(snapshot, constraints, cashSchedule(snapshot, model, [change])) !== undefined
  );
}

/** In-horizon receipts of explicitly linked open renewal invoices, in date then invoice-ID order. */
function renewalReceipts(snapshot: Snapshot, base: CashSchedule): CashItem[] {
  const end = horizonEnd(base.weeks);
  const ids = new Set(
    snapshot.deals.flatMap((d) =>
      d.kind === "renewal" && typeof d.invoiceId === "string" && d.stage !== "lost"
        ? [d.invoiceId]
        : [],
    ),
  );
  return base.items
    .filter((i) => i.kind === "invoice" && ids.has(i.id) && i.date <= end)
    .sort((a, b) => (a.date === b.date ? compareIds(a.id, b.id) : a.date < b.date ? -1 : 1));
}

/**
 * Smallest total cents lost across renewal receipts that breaks survival. Losses reduce the
 * receipts themselves, so the same-day inflow stage of both the weekly fold and the funding replay
 * sees less cash; they are not modelled as later outflows.
 */
function lossPoint(
  snapshot: Snapshot,
  model: CompanyModel,
  constraints: Constraint[],
  base: CashSchedule,
): BreakingPoint[] {
  const receipts = renewalReceipts(snapshot, base);
  if (!receipts.length) return [];
  const total = receipts.reduce((s, i) => s + i.amount, 0);
  const lost = smallestFailing(total, (cents) => lossFails(snapshot, constraints, base, cents));
  if (lost === undefined) return [];
  return [
    {
      label: `Losing ${money(lost)} or more of renewal receipts`,
      threshold: lost,
      unit: "cents_lost",
    },
  ];
}

export function lossFails(
  snapshot: Snapshot,
  constraints: Constraint[],
  base: CashSchedule,
  cents: number,
): boolean {
  let left = cents;
  const cut = new Map<CashItem, number>();
  for (const item of renewalReceipts(snapshot, base)) {
    const take = Math.min(left, item.amount);
    cut.set(item, take);
    left -= take;
  }
  const items = base.items.map((i) => ({ ...i, amount: i.amount - (cut.get(i) ?? 0) }));
  return survivalBreach(snapshot, constraints, { weeks: base.weeks, items }) !== undefined;
}
