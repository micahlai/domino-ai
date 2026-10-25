import type {
  Cents,
  Change,
  CompanyModel,
  Constraint,
  Forecast,
  ISODate,
  Snapshot,
} from "@domino/contracts";
import { addDays, daysBetween, horizonEnd } from "./dates";
import { money } from "./dominoes";
import { type CashSchedule, cashSchedule, forecastFromSchedule } from "./forecast";
import { type OutOfCash, outOfCash } from "./out-of-cash";
import {
  type PredictionKind,
  type PredictionParamName,
  buildPredictions,
  predictionCatalog,
} from "./predictions";
import { evaluateOnSchedule, weeklyBreach } from "./rules";
import { bucketOf } from "./schedule";

/**
 * Second-order consequences ("cascades"), pure and deterministic. A scenario's forecast is
 * scanned for TRIGGERS (a lender-minimum breach, a cash gap, a big customer shock, stretched
 * vendors, a credit line draw, a windfall). Each trigger proposes follow-on events as ordinary
 * Changes, taken from standard treasury practice; an estimator may combine up to three of them
 * into one branch (companies usually respond with several actions at once). Each follow-on is
 * re-run through forecast() on the complete change list, so every number comes from the engine.
 * Likelihoods are stated labels, not probabilities. Nothing here moves money.
 */
export const CASCADE_VERSION = "cascade@1.2.0";

export type CascadeLikelihood = "Expected" | "Likely" | "Possible";
export type TriggerKind =
  | "cash_gap"
  | "lender_minimum"
  | "customer_shock"
  | "vendor_stretch"
  | "credit_draw"
  | "windfall"
  | "growth";

export type CascadeTrigger = {
  kind: TriggerKind;
  /** Plain sentence: what in the parent forecast caused the follow-on */
  label: string;
  week: number;
  weekStart: ISODate;
  date: ISODate;
  amount: Cents;
};

export type CascadeNode = {
  /** Path id: "1", "1.2", "1.2.1" */
  id: string;
  /** null = follows the scenario itself */
  parentId: string | null;
  depth: number;
  trigger: CascadeTrigger;
  /** The follow-on event, for example "Lender freezes the credit line" */
  event: string;
  /** Short name for this alternative among its siblings */
  branchLabel: string;
  /** Why this tends to happen, and the stated assumption behind the numbers */
  reason: string;
  likelihood: CascadeLikelihood;
  /** This node's own changes, applied after every ancestor's */
  changes: Change[];
  /** Complete ordered change list behind `forecast` */
  allChanges: Change[];
  forecast: Forecast;
  lowPoint: Forecast["lowPoint"];
  /** Earliest date the node's own changes act */
  startsOn: ISODate;
  /** Terminal: this branch runs out of cash; only survival responses may follow it. */
  outOfCash: OutOfCash | null;
  /** Who picked this reaction: a model's estimate, or the fixed rules */
  estimate: CascadeEstimate;
};

export type CascadeInput = {
  snapshot: Snapshot;
  model: CompanyModel;
  constraints: Constraint[];
  /** Complete changes before the scenario (its parent run's list) */
  baseChanges: Change[];
  /** The scenario's own changes */
  eventChanges: Change[];
  eventLabel: string;
};

export type CascadeResult = {
  version: string;
  event: string;
  forecast: Forecast;
  /** The scenario itself runs out of cash (before any follow-on) */
  outOfCash: OutOfCash | null;
  nodes: CascadeNode[];
};

export type CascadeLimits = {
  maxDepth: number;
  /** Follow-on branches per parent when `branchesByDepth` names none for its depth */
  maxBranches: number;
  maxNodes: number;
  /** Branches per parent by the parent's depth (0 = the scenario itself) */
  branchesByDepth?: number[];
};
/** Two branches at the first two levels, one at levels 3 and 4: at most 2 + 4 + 4 + 4 = 14. */
export const CASCADE_LIMITS: CascadeLimits = {
  maxDepth: 4,
  maxBranches: 2,
  maxNodes: 14,
  branchesByDepth: [2, 2, 1, 1],
};
/** An estimator's branch combines at most this many catalog reactions, applied together. */
export const MAX_REACTION_KINDS = 3;
const MAX_REACTION_BRANCHES = 2;

// Stated assumptions (standard practice; shown in each reason).
const WAIVER_FEE_BPS = 25n; // amendment/waiver fee ~0.25% of the covenant level
const MIN_WAIVER_FEE = 1_000_000; // $10K floor for lender legal costs
const DEFAULT_RATE_BPS = 200n; // default interest step-up +2%/yr
export const REVOLVER_RATE_BPS = 800n; // drawn revolver ~8%/yr (SOFR + ~3.5%)
const LATE_FEE_BPS = 150n; // 1.5% per month late fee on net-30 invoices
const STRETCH_DAYS = 30;
const PEER_DELAY_DAYS = 7;
const HIRE_PAUSE_BPS = 500n; // planned hires ~5% of monthly payroll
const HIRE_PULL_BPS = 1_000n; // pulled-forward hiring ~10% of the windfall per month
const SUPPORT_HIRE_BPS = 3_000n; // hiring to support growth ~30% of the added monthly receipts
const DRAW_ROUND = 5_000_000; // draws in $50K steps
const MAX_BILLS = 8;
export const DRAW_LABEL = /credit line|revolver|line draw/i;

type Ctx = {
  input: CascadeInput;
  weeks: ISODate[];
  end: ISODate;
  /** Base (pre-scenario) schedule, for customer shares */
  base: CashSchedule;
};
type Level = {
  id: string | null;
  depth: number;
  prior: Change[];
  own: Change[];
  all: Change[];
  schedule: CashSchedule;
  forecast: Forecast;
  fired: Set<string>;
  /** Follow-on events on this branch so far, oldest first (the scenario itself excluded) */
  chain: string[];
};
type Option = {
  event: string;
  branchLabel: string;
  reason: string;
  likelihood: CascadeLikelihood;
  changes: Change[];
};
type Found = { key: string; trigger: CascadeTrigger; options: Option[] };

/** Synchronous, rule-based cascade: every trigger uses its catalog's rule options in order. */
export function cascade(input: CascadeInput, limits = CASCADE_LIMITS): CascadeResult {
  const steps = cascadeSteps(input, limits);
  let step = steps.next();
  while (!step.done) step = steps.next(null);
  return step.value;
}

/**
 * Same cascade, but each trigger's reactions may be chosen by `decide` (for example a model's
 * estimate). The engine still builds every Change and computes every forecast; `decide` only
 * picks catalog entries and bounded parameters, and returning null keeps the fixed rules.
 */
export async function cascadeWith(
  input: CascadeInput,
  decide: (request: ReactionRequest) => Promise<unknown | null>,
  limits = CASCADE_LIMITS,
): Promise<CascadeResult> {
  const steps = cascadeSteps(input, limits);
  let step = steps.next();
  while (!step.done) {
    let raw: unknown | null = null;
    try {
      raw = await decide(step.value);
    } catch {
      raw = null;
    }
    step = steps.next(
      raw === null ? null : resolveReactions(step.value.catalog, raw, step.value.branches),
    );
  }
  return step.value;
}

/** One trigger awaiting a choice of reactions from its catalog. */
export type ReactionRequest = {
  /** Cache key parts: the branch it fires on and the trigger */
  levelId: string | null;
  depth: number;
  key: string;
  trigger: CascadeTrigger;
  event: string;
  /** Follow-on events already on this branch, oldest first, after the scenario itself */
  chain: string[];
  lowPoint: Forecast["lowPoint"];
  catalog: ReactionCatalogEntry[];
  /** How many alternative branches this trigger may still add */
  branches: number;
};
export type ReactionCatalogEntry = {
  kindId: string;
  label: string;
  event: string;
  reason: string;
  /** Outside the fixed rules: market and reputation effects, offered to an estimator only */
  external: boolean;
  param: { name: "days" | "percent" | "count"; min: number; max: number; default: number } | null;
};
/** One alternative branch: 1-3 catalog reactions that happen together. */
export type ReactionChoice = {
  kinds: { kindId: string; param: number | null }[];
  probability: number;
  reason: string;
};
export type CascadeEstimate =
  | { source: "ai"; probability: number; reason: string }
  | { source: "rule" };

/**
 * Read `{ branches: [{ kinds: [{ kindId, param }], probability, reason }] }`: keep only catalog
 * kinds (1-3 distinct per branch), at most `maxBranches` branches with distinct kind sets, clamp
 * parameters to their bounds and renormalize probabilities to sum to 1 across the kept branches.
 * Anything unusable yields null (fixed rules).
 */
export function resolveReactions(
  catalog: ReactionCatalogEntry[],
  raw: unknown,
  maxBranches = MAX_REACTION_BRANCHES,
): ReactionChoice[] | null {
  const list =
    raw && typeof raw === "object" && Array.isArray((raw as { branches?: unknown }).branches)
      ? ((raw as { branches: unknown[] }).branches ?? [])
      : [];
  const limit = Math.max(1, Math.min(MAX_REACTION_BRANCHES, Math.floor(maxBranches)));
  const out: ReactionChoice[] = [];
  const seen = new Set<string>();
  for (const b of list) {
    if (!b || typeof b !== "object" || out.length >= limit) continue;
    const row = b as Record<string, unknown>;
    const p =
      typeof row.probability === "number" && Number.isFinite(row.probability) ? row.probability : 0;
    if (p <= 0) continue;
    const kinds: ReactionChoice["kinds"] = [];
    const reasons: string[] = [];
    for (const k of Array.isArray(row.kinds) ? row.kinds : []) {
      if (!k || typeof k !== "object" || kinds.length >= MAX_REACTION_KINDS) continue;
      const pick = k as Record<string, unknown>;
      const entry = catalog.find((c) => c.kindId === pick.kindId);
      if (!entry || kinds.some((o) => o.kindId === entry.kindId)) continue;
      const value =
        typeof pick.param === "number" && Number.isFinite(pick.param) ? pick.param : null;
      const param = entry.param
        ? Math.round(
            Math.min(entry.param.max, Math.max(entry.param.min, value ?? entry.param.default)),
          )
        : null;
      kinds.push({ kindId: entry.kindId, param });
      reasons.push(entry.reason);
    }
    const key = kinds
      .map((k) => k.kindId)
      .sort()
      .join("+");
    if (!kinds.length || seen.has(key)) continue;
    seen.add(key);
    const reason = typeof row.reason === "string" ? row.reason.trim().slice(0, 160) : "";
    out.push({ kinds, probability: Math.min(1, p), reason: reason || reasons.join(" ") });
  }
  if (!out.length) return null;
  const total = out.reduce((a, o) => a + o.probability, 0);
  return out.map((o) => ({ ...o, probability: Math.round((o.probability / total) * 100) / 100 }));
}

const kindIdOf = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

function* cascadeSteps(
  input: CascadeInput,
  limits: CascadeLimits,
): Generator<ReactionRequest, CascadeResult, ReactionChoice[] | null> {
  const { snapshot, model } = input;
  const all = [...input.baseChanges, ...input.eventChanges];
  const schedule = cashSchedule(snapshot, model, all);
  const forecast = forecastFromSchedule(snapshot, schedule);
  const base = cashSchedule(snapshot, model, input.baseChanges);
  const ctx: Ctx = { input, weeks: schedule.weeks, end: horizonEnd(schedule.weeks), base };
  const nodes: CascadeNode[] = [];
  const queue: Level[] = [
    {
      id: null,
      depth: 0,
      prior: input.baseChanges,
      own: input.eventChanges,
      all,
      schedule,
      forecast,
      fired: new Set(),
      chain: [],
    },
  ];
  // Breadth first, so the node budget is shared fairly across the first levels.
  while (queue.length > 0 && nodes.length < limits.maxNodes) {
    const level = queue.shift() as Level;
    if (level.depth >= limits.maxDepth) continue;
    // Out of cash is terminal: only the survival responses to the gap (stretch vendors, an
    // emergency credit draw) can follow it; ordinary knock-on effects stop there.
    const terminal = outOfCash(level.forecast) !== null;
    const found = triggers(ctx, level).filter(
      (f) => !level.fired.has(f.key) && (!terminal || f.key === "cash_gap"),
    );
    const cap = limits.branchesByDepth?.[level.depth] ?? limits.maxBranches;
    let n = 0;
    for (const f of found) {
      if (n >= cap || nodes.length >= limits.maxNodes) break;
      const external = terminal ? [] : externalReactions(ctx, level, f);
      const kinds = [
        ...f.options.map((o) => ({ option: o, external: false, param: null })),
        ...external,
      ];
      const catalog: ReactionCatalogEntry[] = kinds.map((k) => ({
        kindId: kindIdOf(k.option.branchLabel),
        label: k.option.branchLabel,
        event: k.option.event,
        reason: k.option.reason,
        external: k.external,
        param: k.param ? { ...k.param.bounds } : null,
      }));
      const choices: ReactionChoice[] | null = yield {
        levelId: level.id,
        depth: level.depth,
        key: f.key,
        trigger: f.trigger,
        event: input.eventLabel,
        chain: level.chain,
        lowPoint: level.forecast.lowPoint,
        catalog,
        branches: cap - n,
      };
      // Rule-based: the trigger's own options, in order. AI: each branch's chosen kinds with
      // their parameters, applied together as one combined reaction.
      const picks: { option: Option; estimate: CascadeEstimate }[] = choices
        ? choices.flatMap((c) => {
            const parts = c.kinds.flatMap((pick) => {
              const k = kinds[catalog.findIndex((e) => e.kindId === pick.kindId)];
              if (!k) return [];
              return [k.param ? k.param.build(pick.param ?? k.param.bounds.default) : k.option];
            });
            const option = combine(level.all, parts);
            if (!option) return [];
            return [
              {
                option,
                estimate: { source: "ai" as const, probability: c.probability, reason: c.reason },
              },
            ];
          })
        : f.options.map((option) => ({ option, estimate: { source: "rule" as const } }));
      for (const { option, estimate } of picks) {
        if (n >= cap || nodes.length >= limits.maxNodes) break;
        const childAll = [...level.all, ...option.changes];
        let childSchedule: CashSchedule;
        try {
          childSchedule = cashSchedule(snapshot, model, childAll);
        } catch {
          continue; // a follow-on the engine cannot apply is left out, never guessed
        }
        const childForecast = forecastFromSchedule(snapshot, childSchedule);
        if (sameCash(childForecast, level.forecast)) continue;
        n += 1;
        const id = level.id === null ? String(n) : `${level.id}.${n}`;
        nodes.push({
          id,
          parentId: level.id,
          depth: level.depth + 1,
          trigger: f.trigger,
          event: option.event,
          branchLabel: option.branchLabel,
          reason: option.reason,
          likelihood: option.likelihood,
          changes: option.changes,
          allChanges: childAll,
          forecast: childForecast,
          lowPoint: childForecast.lowPoint,
          startsOn: startOf(option.changes, snapshot) ?? f.trigger.date,
          outOfCash: outOfCash(childForecast),
          estimate,
        });
        queue.push({
          id,
          depth: level.depth + 1,
          prior: level.all,
          own: option.changes,
          all: childAll,
          schedule: childSchedule,
          forecast: childForecast,
          fired: new Set([...level.fired, f.key]),
          chain: [...level.chain, option.event],
        });
      }
    }
  }
  return {
    version: CASCADE_VERSION,
    event: input.eventLabel,
    forecast,
    outOfCash: outOfCash(forecast),
    nodes,
  };
}

const LIKELIHOOD_ORDER: CascadeLikelihood[] = ["Expected", "Likely", "Possible"];

/**
 * Several reactions that happen together, as one option. Later parts skip any change to a bill,
 * invoice or customer an earlier part already moved (two delays of one bill would stack), and
 * labelled cash gets a label no other change uses. The joint likelihood is the weakest part's.
 */
function combine(prior: Change[], parts: Option[]): Option | null {
  if (parts.length <= 1) return parts[0] ?? null;
  const changes: Change[] = [];
  const used: Option[] = [];
  const targetOf = (c: Change): string | null =>
    c.kind === "delay_bill"
      ? `bill:${c.billId}`
      : c.kind === "delay_invoice" || c.kind === "lose_invoice" || c.kind === "discount_early_pay"
        ? `invoice:${c.invoiceId}`
        : c.kind === "delay_customer"
          ? `customer:${c.customerId}`
          : null;
  const taken = new Set(prior.flatMap((c) => targetOf(c) ?? []));
  for (const part of parts) {
    const own: Change[] = [];
    for (const c of part.changes) {
      const target = targetOf(c);
      if (target && taken.has(target)) continue;
      if (target) taken.add(target);
      own.push(
        "label" in c
          ? ({ ...c, label: unique([...prior, ...changes, ...own], c.label) } as Change)
          : c,
      );
    }
    if (!own.length) continue;
    changes.push(...own);
    used.push(part);
  }
  if (!used.length) return null;
  if (used.length === 1) return { ...(used[0] as Option), changes };
  return {
    event: used.map((o) => o.event).join("; "),
    branchLabel: used.map((o) => o.branchLabel).join(" + "),
    reason: used.map((o) => o.reason).join(" "),
    likelihood:
      LIKELIHOOD_ORDER[Math.max(...used.map((o) => LIKELIHOOD_ORDER.indexOf(o.likelihood)))] ??
      "Possible",
    changes,
  };
}

type External = {
  option: Option;
  external: true;
  param: {
    bounds: { name: "days" | "percent" | "count"; min: number; max: number; default: number };
    build: (value: number) => Option;
  };
};

/**
 * Reactions outside the fixed rules, offered only to an estimator: a market downturn slows
 * collections, a reputation hit after a cash squeeze shrinks renewals, and good news grows
 * billing. Each is an ordinary bounded Change list the engine evaluates like any other.
 */
function externalReactions(ctx: Ctx, level: Level, f: Found): External[] {
  const { snapshot } = ctx.input;
  const from = maxDate(addDays(snapshot.asOf, 1), f.trigger.date);
  if (from > ctx.end) return [];
  const out: External[] = [];
  const hasPlans = level.schedule.items.some((i) => i.kind === "plan" && i.date >= from);
  if (f.key === "cash_gap" || f.key === "lender_minimum" || f.key === "customer_shock") {
    const byCustomer = new Map<string, number>();
    for (const i of level.schedule.items)
      if (i.customerId && i.amount > 0 && i.date >= from && i.date <= ctx.end)
        byCustomer.set(i.customerId, (byCustomer.get(i.customerId) ?? 0) + i.amount);
    const payers = [...byCustomer.entries()]
      .sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))
      .slice(0, MAX_BILLS)
      .map(([id]) => id);
    const build = (days: number): Option => ({
      event: `Market downturn: customers pay ${days} days later`,
      branchLabel: "Market downturn",
      reason: `Estimated outside effect: in a downturn customers stretch their own payables, so receipts from the ${payers.length} largest payers slip ${days} days.`,
      likelihood: "Possible",
      changes: payers.map((customerId) => ({
        kind: "delay_customer" as const,
        customerId,
        days,
        fromDate: from,
        basis: `Estimated market downturn: ${days} days slower`,
      })),
    });
    if (payers.length)
      out.push({
        option: build(14),
        external: true,
        param: { bounds: { name: "days", min: 7, max: 45, default: 14 }, build },
      });
  }
  if ((f.key === "cash_gap" || f.key === "lender_minimum") && hasPlans) {
    const build = (pct: number): Option => ({
      event: `Word of the cash squeeze gets out: renewals shrink ${pct}%`,
      branchLabel: "Reputation hit",
      reason: `Estimated outside effect: customers who hear about a cash squeeze renew smaller or later, so recurring billing falls ${pct}% from ${from}.`,
      likelihood: "Possible",
      changes: [
        {
          kind: "scale_recurring" as const,
          label: unique(level.all, `Reputation hit, billing down ${pct}%`),
          flows: "billing" as const,
          names: [],
          percent: -pct,
          fromDate: from,
        },
      ],
    });
    out.push({
      option: build(10),
      external: true,
      param: { bounds: { name: "percent", min: 5, max: 30, default: 10 }, build },
    });
  }
  if (f.key === "windfall" || f.key === "growth") {
    out.push(...predicted(ctx, level, from, "hiring_wave", "headcount", "Growth hiring"));
    out.push(...predicted(ctx, level, from, "new_customers", "count", "Word of mouth"));
  }
  if (f.key === "windfall" && hasPlans) {
    const build = (pct: number): Option => ({
      event: `Positive press: new business grows billing ${pct}%`,
      branchLabel: "Positive press",
      reason: `Estimated outside effect: a visible win speeds up the pipeline, so recurring billing grows ${pct}% from ${from}.`,
      likelihood: "Possible",
      changes: [
        {
          kind: "scale_recurring" as const,
          label: unique(level.all, `Positive press, billing up ${pct}%`),
          flows: "billing" as const,
          names: [],
          percent: pct,
          fromDate: from,
        },
      ],
    });
    out.push({
      option: build(5),
      external: true,
      param: { bounds: { name: "percent", min: 2, max: 20, default: 5 }, build },
    });
  }
  return out;
}

/**
 * A predicted consequence (the shared prediction catalog) as an estimator-only reaction with its
 * main count parameter; the other parameters keep the company-sized defaults.
 */
function predicted(
  ctx: Ctx,
  level: Level,
  from: ISODate,
  kind: PredictionKind,
  param: PredictionParamName,
  branchLabel: string,
): External[] {
  const { snapshot, model } = ctx.input;
  const entry = predictionCatalog(snapshot, model, level.all).find((e) => e.kind === kind);
  const bound = entry?.params.find((p) => p.name === param);
  if (!entry || !bound) return [];
  const defaults = Object.fromEntries(entry.params.map((p) => [p.name, p.default]));
  const build = (value: number): Option => {
    const [made] = buildPredictions(
      snapshot,
      model,
      level.all,
      [
        {
          kind,
          params: { ...defaults, [param]: value },
          startInDays: 0,
          probability: 1,
          reason: entry.meaning,
        },
      ],
      from,
      null,
    );
    return {
      event: made?.effect ?? entry.title,
      branchLabel,
      reason: `Estimated follow-on: ${entry.meaning}. Sized from the company's own books.`,
      likelihood: "Possible",
      changes: made?.changes ?? [],
    };
  };
  return [
    {
      option: build(bound.default),
      external: true,
      param: {
        bounds: { name: "count", min: bound.min, max: bound.max, default: bound.default },
        build,
      },
    },
  ];
}

// ---------- Triggers, in priority order ----------

function triggers(ctx: Ctx, level: Level): Found[] {
  const { snapshot, model, constraints } = ctx.input;
  const priorSchedule = cashSchedule(snapshot, model, level.prior);
  const prior = forecastFromSchedule(snapshot, priorSchedule);
  const floor = maxDate(
    startOf(level.own, snapshot) ?? addDays(snapshot.asOf, 1),
    addDays(snapshot.asOf, 1),
  );
  const out: Found[] = [];
  const gap = cashGap(ctx, level, prior, priorSchedule);
  if (gap) out.push(gapOptions(ctx, level, gap, floor));
  for (const c of constraints) {
    if (c.kind !== "min_cash") continue;
    const now = weeklyBreach(c, snapshot, level.forecast);
    const before = weeklyBreach(c, snapshot, prior);
    if (now && now.kind === "min_cash" && (!before || before.week > now.week)) {
      const trigger: CascadeTrigger = {
        kind: "lender_minimum",
        label: `Usable cash falls to ${money(now.usable)} in the week of ${now.weekStart}, below ${c.label} of ${money(c.limit)}`,
        week: now.week,
        weekStart: now.weekStart,
        date: now.date,
        amount: c.limit - now.usable,
      };
      out.push({
        key: "lender_minimum",
        trigger,
        options: lenderOptions(ctx, level, c, trigger, floor),
      });
      break;
    }
  }
  const shock = customerShock(ctx, level, prior);
  if (shock) out.push(shockOptions(ctx, level, shock, floor));
  const stretch = vendorStretch(ctx, level);
  if (stretch) out.push(stretch);
  const draw = creditDraw(ctx, level);
  if (draw) out.push(draw);
  const windfall = windfallOf(ctx, level, prior);
  if (windfall) out.push(windfall);
  const growth = growthOf(ctx, level, prior);
  if (growth) out.push(growth);
  return out.filter((f) => f.options.length > 0);
}

/** First week usable cash goes negative, or a pay-by-date rule newly fails. */
function cashGap(ctx: Ctx, level: Level, prior: Forecast, priorSchedule: CashSchedule) {
  const { snapshot, constraints } = ctx.input;
  const firstNegative = (f: Forecast) => f.weeks.findIndex((w) => w.usable < 0);
  const now = firstNegative(level.forecast);
  const before = firstNegative(prior);
  if (now >= 0 && (before < 0 || before > now)) {
    const w = level.forecast.weeks[now] as Forecast["weeks"][number];
    const payroll = level.schedule.items.find(
      (i) => i.kind === "payroll" && bucketOf(i.date, ctx.weeks) === now,
    );
    const short = Math.max(...level.forecast.weeks.slice(now).map((x) => -x.usable));
    return {
      label: `Usable cash goes to ${money(w.usable)} in the week of ${w.weekStart}${payroll ? `, so the ${money(-payroll.amount)} payroll on ${payroll.date} cannot be fully covered` : ""}`,
      week: now,
      weekStart: w.weekStart,
      date: payroll?.date ?? w.weekStart,
      amount: short,
    };
  }
  const payBy = constraints.filter((c) => c.kind === "pay_by_date" && c.billId !== undefined);
  if (payBy.length === 0) return null;
  const results = (schedule: CashSchedule, f: Forecast) => {
    try {
      return evaluateOnSchedule(snapshot, f, payBy, schedule);
    } catch {
      return [];
    }
  };
  const was = new Set(
    results(priorSchedule, prior)
      .filter((r) => r.status === "breached")
      .map((r) => r.constraint.id),
  );
  for (const r of results(level.schedule, level.forecast)) {
    const b = r.breach;
    if (r.status !== "breached" || was.has(r.constraint.id) || b?.kind !== "pay_by_date") continue;
    return {
      label: `The ${money(b.bill.amount)} ${b.bill.vendor} bill cannot be funded by its ${b.deadline} deadline (${r.constraint.label})`,
      week: b.week,
      weekStart: b.weekStart,
      date: b.deadline,
      amount: b.bill.amount,
    };
  }
  return null;
}

function gapOptions(
  ctx: Ctx,
  level: Level,
  gap: Omit<CascadeTrigger, "kind">,
  floor: ISODate,
): Found {
  const trigger: CascadeTrigger = { kind: "cash_gap", ...gap };
  const options: Option[] = [];
  const from = maxDate(floor, addDays(gap.weekStart, -14));
  const bills = stretchableBills(ctx, level, from, addDays(gap.weekStart, 27));
  if (bills.length > 0)
    options.push({
      event: `Company stretches ${bills.length} vendor bill${bills.length === 1 ? "" : "s"} ${STRETCH_DAYS} days`,
      branchLabel: "Stretch vendors",
      reason: `When cash cannot cover payroll, companies protect payroll and pay non-critical vendors later. Moves ${money(sum(bills))} of bills due around the gap out ${STRETCH_DAYS} days.`,
      likelihood: "Likely",
      changes: bills.map((b) => ({
        kind: "delay_bill" as const,
        billId: b.id,
        days: STRETCH_DAYS,
      })),
    });
  const amount = Math.ceil(gap.amount / DRAW_ROUND) * DRAW_ROUND;
  const on = maxDate(floor, gap.weekStart);
  if (amount > 0 && on <= ctx.end)
    options.push({
      event: `Company draws ${money(amount)} on its credit line`,
      branchLabel: "Draw credit line",
      reason: `If a revolving credit line is available (none is in the books, so this is an assumption), the company draws enough to cover the ${money(gap.amount)} gap, in $50K steps.`,
      likelihood: "Possible",
      changes: [
        { kind: "add_cash", date: on, amount, label: unique(level.all, "Credit line draw") },
      ],
    });
  return { key: "cash_gap", trigger, options };
}

function lenderOptions(
  ctx: Ctx,
  level: Level,
  c: Constraint,
  trigger: CascadeTrigger,
  floor: ISODate,
): Option[] {
  const options: Option[] = [];
  const raw = Number((BigInt(Math.max(0, Math.round(c.limit))) * WAIVER_FEE_BPS) / 10_000n);
  const fee = Math.ceil(Math.max(raw, MIN_WAIVER_FEE) / 100_000) * 100_000;
  const feeOn = clampDate(addDays(trigger.date, 14), floor, ctx.end);
  if (feeOn)
    options.push({
      event: `Lender grants a waiver for a ${money(fee)} fee`,
      branchLabel: "Waiver (fee)",
      reason: `Lenders usually waive a first covenant breach for an amendment fee plus legal costs. Assumed 0.25% of ${c.label} (at least $10K), paid about 2 weeks after the breach.`,
      likelihood: "Likely",
      changes: [
        {
          kind: "remove_cash",
          date: feeOn,
          amount: fee,
          label: unique(level.all, "Covenant waiver fee"),
        },
      ],
    });
  // Freeze: draws on or after the breach week are blocked; earlier draws pay default interest.
  const draws = drawsIn(level.all);
  const blocked = draws.filter((d) => d.date >= trigger.weekStart);
  const outstanding = sum(draws.filter((d) => d.date < trigger.weekStart));
  const taken = [...level.all];
  const freeze: Change[] = [];
  for (const d of blocked) {
    const change: Change = {
      kind: "remove_cash",
      date: d.date,
      amount: d.amount,
      label: unique(taken, `Blocked: ${d.label}`),
    };
    taken.push(change);
    freeze.push(change);
  }
  for (const due of monthly(addDays(trigger.date, 30), ctx.end)) {
    const amount = interest(outstanding, DEFAULT_RATE_BPS, 30);
    if (amount <= 0 || due < floor) continue;
    const change: Change = {
      kind: "remove_cash",
      date: due,
      amount,
      label: unique(taken, `Default interest ${due}`),
    };
    taken.push(change);
    freeze.push(change);
  }
  if (freeze.length > 0) {
    options.push({
      event: "Lender freezes the credit line",
      branchLabel: "Credit line frozen",
      reason: `After a covenant breach the lender can refuse new draws and charge default interest (assumed +2%/yr on ${money(outstanding)} already drawn). Draws planned from the week of ${trigger.weekStart} are blocked.`,
      likelihood: "Possible",
      changes: freeze,
    });
  } else {
    const bills = stretchableBills(ctx, level, maxDate(floor, trigger.weekStart), ctx.end);
    if (bills.length > 0)
      options.push({
        event: `Lender freezes the credit line, so the company stretches ${bills.length} vendor bill${bills.length === 1 ? "" : "s"}`,
        branchLabel: "Credit line frozen",
        reason: `With new draws refused after the breach, the company's backstop is gone and it pays non-critical vendors ${STRETCH_DAYS} days later (${money(sum(bills))} of bills).`,
        likelihood: "Possible",
        changes: bills.map((b) => ({
          kind: "delay_bill" as const,
          billId: b.id,
          days: STRETCH_DAYS,
        })),
      });
  }
  return options;
}

/** Own churn, loss or a 21+ day delay hitting the largest customer (or one with 15%+ of collections). */
function customerShock(ctx: Ctx, level: Level, prior: Forecast) {
  const { snapshot } = ctx.input;
  const ids = new Set<string>();
  for (const c of level.own) {
    if (c.kind === "churn") ids.add(c.customerId);
    if (c.kind === "lose_invoice" || (c.kind === "delay_invoice" && c.days >= 21)) {
      const inv = snapshot.invoices.find((i) => i.id === c.invoiceId);
      if (inv) ids.add(inv.customerId);
    }
  }
  if (ids.size === 0) return null;
  const shares = collections(ctx.base, ctx.end);
  const total = [...shares.values()].reduce((a, b) => a + b, 0);
  const largest = [...shares.entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))[0]?.[0];
  const hit = [...ids]
    .sort(cmp)
    .find((id) => id === largest || (shares.get(id) ?? 0) * 100 >= total * 15);
  if (!hit) return null;
  const name = snapshot.customers.find((c) => c.id === hit)?.name ?? hit;
  const lost = (shares.get(hit) ?? 0) - (collections(level.schedule, ctx.end).get(hit) ?? 0);
  const delta = level.forecast.weeks.findIndex((w, i) => w.usable !== prior.weeks[i]?.usable);
  const week = Math.max(0, delta);
  return {
    customerId: hit,
    label: `${name}, ${hit === largest ? "the largest customer" : `${Math.round(((shares.get(hit) ?? 0) * 100) / Math.max(1, total))}% of expected collections`}, stops paying on time`,
    week,
    weekStart: ctx.weeks[week] as ISODate,
    date: startOf(level.own, snapshot) ?? (ctx.weeks[week] as ISODate),
    amount: Math.max(0, lost),
  };
}

function shockOptions(
  ctx: Ctx,
  level: Level,
  shock: Omit<CascadeTrigger, "kind"> & { customerId: string },
  floor: ISODate,
): Found {
  const { customerId, ...rest } = shock;
  const trigger: CascadeTrigger = { kind: "customer_shock", ...rest };
  const { snapshot } = ctx.input;
  const options: Option[] = [];
  const payroll = sum(
    level.schedule.items.filter(
      (i) => i.kind === "payroll" && i.date > snapshot.asOf && i.date <= ctx.end,
    ),
    true,
  );
  const months = daysBetween(snapshot.asOf, ctx.end) / 30.4;
  const monthlyCost = Number((BigInt(Math.round(payroll / months)) * HIRE_PAUSE_BPS) / 10_000n);
  const fromDate = maxDate(floor, addDays(shock.date, 14));
  if (monthlyCost > 0 && fromDate <= ctx.end)
    options.push({
      event: "Planned hiring is paused",
      branchLabel: "Pause hiring",
      reason: `Losing the biggest payer usually freezes open roles. Assumed planned hires of about 5% of monthly payroll (${money(monthlyCost)}/month), not spent from ${fromDate}.`,
      likelihood: "Likely",
      changes: [
        {
          kind: "shift_hire",
          label: unique(level.all, "Paused hiring"),
          monthlyCost,
          fromDate,
          toDate: addDays(ctx.end, 1),
        },
      ],
    });
  const terms = snapshot.customers.find((c) => c.id === customerId)?.paymentTermsDays;
  const peerIds = new Set(
    snapshot.customers
      .filter((c) => c.id !== customerId && c.paymentTermsDays === terms)
      .map((c) => c.id),
  );
  const touched = touchedInvoices(level.all);
  const peers = level.schedule.items
    .filter(
      (i) =>
        i.kind === "invoice" &&
        i.customerId !== undefined &&
        peerIds.has(i.customerId) &&
        i.amount > 0 &&
        i.date >= floor &&
        i.date <= ctx.end &&
        !touched.has(i.id) &&
        (snapshot.invoices.find((x) => x.id === i.id)?.due ?? "") >= floor,
    )
    .sort((a, b) => b.amount - a.amount || cmp(a.id, b.id))
    .slice(0, 3);
  if (peers.length > 0)
    options.push({
      event: `${peers.length} other customer${peers.length === 1 ? "" : "s"} on ${terms}-day terms pay ${PEER_DELAY_DAYS} days later`,
      branchLabel: "Peers pay later",
      reason: `When a big customer in a segment slows payment, peers on the same terms often stretch too. Assumed a modest ${PEER_DELAY_DAYS}-day slip on their ${peers.length} largest open invoices (${money(sum(peers))}).`,
      likelihood: "Possible",
      changes: peers.map((i) => ({
        kind: "delay_invoice" as const,
        invoiceId: i.id,
        days: PEER_DELAY_DAYS,
      })),
    });
  return { key: "customer_shock", trigger, options };
}

/** Own vendor stretches of 14+ days lead to late fees or prepayment demands. */
function vendorStretch(ctx: Ctx, level: Level): Found | null {
  const { snapshot } = ctx.input;
  const stretched = level.own.flatMap((c) => {
    if (c.kind !== "delay_bill" || c.days < 14) return [];
    const bill = snapshot.bills.find((b) => b.id === c.billId);
    return bill ? [{ bill, payOn: addDays(bill.due, c.days) }] : [];
  });
  if (stretched.length === 0) return null;
  const first = stretched.map((s) => s.bill.due).sort()[0] as ISODate;
  const week = bucketOf(first, ctx.weeks) ?? 0;
  const trigger: CascadeTrigger = {
    kind: "vendor_stretch",
    label: `${stretched.length} vendor bill${stretched.length === 1 ? " is" : "s are"} paid ${STRETCH_DAYS}+ days late (${money(sum(stretched.map((s) => s.bill)))})`,
    week,
    weekStart: ctx.weeks[week] as ISODate,
    date: first,
    amount: sum(stretched.map((s) => s.bill)),
  };
  const options: Option[] = [];
  const taken = [...level.all];
  const fees: Extract<Change, { kind: "remove_cash" }>[] = [];
  for (const s of stretched) {
    const amount = interest(s.bill.amount, LATE_FEE_BPS * 12n, daysBetween(s.bill.due, s.payOn));
    if (amount <= 0 || s.payOn > ctx.end) continue;
    const change = {
      kind: "remove_cash" as const,
      date: s.payOn,
      amount,
      label: unique(taken, `Late fee: ${s.bill.vendor}`),
    };
    taken.push(change);
    fees.push(change);
  }
  if (fees.length > 0)
    options.push({
      event: `Vendors add ${money(sum(fees))} in late fees`,
      branchLabel: "Late fees",
      reason:
        "Standard net-30 terms charge about 1.5% per month on late balances, paid with the late bill.",
      likelihood: "Likely",
      changes: fees,
    });
  // The biggest stretched vendor wants its next bill paid up front, on the stretched payment date.
  const big = [...stretched].sort(
    (a, b) => b.bill.amount - a.bill.amount || cmp(a.bill.id, b.bill.id),
  )[0];
  const touched = touchedBills(level.all);
  const next = big
    ? snapshot.bills
        .filter(
          (b) =>
            b.vendor === big.bill.vendor &&
            !b.paid &&
            !b.critical &&
            b.due > big.payOn &&
            !touched.has(b.id),
        )
        .sort((a, b) => cmp(a.due, b.due) || cmp(a.id, b.id))[0]
    : undefined;
  if (big && next && next.due <= ctx.end)
    options.push({
      event: `${big.bill.vendor} moves the company to prepayment`,
      branchLabel: "Prepayment",
      reason: `A key vendor that is paid late often demands cash in advance. Its next ${money(next.amount)} bill is paid on ${big.payOn} instead of ${next.due}.`,
      likelihood: "Possible",
      changes: [{ kind: "delay_bill", billId: next.id, days: -daysBetween(big.payOn, next.due) }],
    });
  return { key: "vendor_stretch", trigger, options };
}

/** Own credit line draws accrue interest, paid monthly. */
function creditDraw(ctx: Ctx, level: Level): Found | null {
  const draws = drawsIn(level.own);
  if (draws.length === 0) return null;
  const first = draws.map((d) => d.date).sort()[0] as ISODate;
  const total = sum(draws);
  const week = bucketOf(first, ctx.weeks) ?? 0;
  const taken = [...level.all];
  const changes: Extract<Change, { kind: "remove_cash" }>[] = [];
  for (const due of monthly(addDays(first, 30), ctx.end)) {
    const amount = interest(total, REVOLVER_RATE_BPS, 30);
    if (amount <= 0) continue;
    const change = {
      kind: "remove_cash" as const,
      date: due,
      amount,
      label: unique(taken, `Credit line interest ${due}`),
    };
    taken.push(change);
    changes.push(change);
  }
  return {
    key: "credit_draw",
    trigger: {
      kind: "credit_draw",
      label: `${money(total)} is drawn on the credit line on ${first}`,
      week,
      weekStart: ctx.weeks[week] as ISODate,
      date: first,
      amount: total,
    },
    options:
      changes.length === 0
        ? []
        : [
            {
              event: `Interest of ${money(sum(changes))} on the draw`,
              branchLabel: "Interest",
              reason:
                "Drawn revolver balances pay interest monthly. Assumed about 8%/yr (SOFR plus a typical spread).",
              likelihood: "Expected",
              changes,
            },
          ],
  };
}

/** Own new cash or early collection worth 2+ weeks of outflow: hire sooner, or repay debt. */
function windfallOf(ctx: Ctx, level: Level, prior: Forecast): Found | null {
  const { snapshot } = ctx.input;
  const own = level.own.filter(
    (c) =>
      (c.kind === "add_cash" && !DRAW_LABEL.test(c.label)) ||
      c.kind === "discount_early_pay" ||
      (c.kind === "delay_invoice" && c.days < 0),
  );
  if (own.length === 0) return null;
  const gains = level.forecast.weeks.map((w, i) => w.usable - (prior.weeks[i]?.usable ?? w.usable));
  const gain = Math.max(...gains);
  const avgOut = prior.weeks.reduce((a, w) => a + w.outflow, 0) / prior.weeks.length;
  if (gain <= 0 || gain < 2 * avgOut) return null;
  const week = gains.indexOf(gain);
  const date = startOf(own, snapshot) ?? (ctx.weeks[week] as ISODate);
  const trigger: CascadeTrigger = {
    kind: "windfall",
    label: `Usable cash is up to ${money(gain)} higher (week of ${ctx.weeks[week]}), more than two weeks of spending`,
    week,
    weekStart: ctx.weeks[week] as ISODate,
    date,
    amount: gain,
  };
  const options: Option[] = [];
  const taken = [...level.all];
  const hires: Change[] = [];
  const perMonth = Number((BigInt(gain) * HIRE_PULL_BPS) / 10_000n);
  for (const due of monthly(addDays(date, 30), ctx.end)) {
    if (perMonth <= 0) continue;
    const change: Change = {
      kind: "remove_cash",
      date: due,
      amount: perMonth,
      label: unique(taken, `Hiring pulled forward ${due}`),
    };
    taken.push(change);
    hires.push(change);
  }
  if (hires.length > 0)
    options.push({
      event: "Planned hiring is pulled forward",
      branchLabel: "Hire sooner",
      reason: `Companies ahead of plan usually accelerate hiring. Assumed new salaries of about 10% of the windfall (${money(perMonth)}/month) from a month later.`,
      likelihood: "Likely",
      changes: hires,
    });
  const drawn = sum(drawsIn(level.all));
  const repayOn = clampDate(addDays(date, 7), date, ctx.end);
  if (drawn > 0 && repayOn) {
    const amount = Math.min(drawn, Math.floor(gain / 2));
    options.push({
      event: `Company repays ${money(amount)} of the credit line early`,
      branchLabel: "Prepay debt",
      reason:
        "Paying down the most expensive debt first is standard. Assumed up to half the windfall goes to the drawn revolver a week after the cash lands.",
      likelihood: "Possible",
      changes: [
        {
          kind: "remove_cash",
          date: repayOn,
          amount,
          label: unique(level.all, "Credit line repayment"),
        },
      ],
    });
  }
  return { key: "windfall", trigger, options };
}

/** Own new recurring receipts or billing growth: the company hires to support it. */
function growthOf(ctx: Ctx, level: Level, prior: Forecast): Found | null {
  const { snapshot } = ctx.input;
  const own = level.own.filter(
    (c) =>
      (c.kind === "recurring_cash" && c.direction === "in") ||
      (c.kind === "scale_recurring" && c.flows === "billing" && c.percent > 0),
  );
  if (own.length === 0) return null;
  const gain =
    level.forecast.weeks.reduce((a, w) => a + w.inflow, 0) -
    prior.weeks.reduce((a, w) => a + w.inflow, 0);
  if (gain <= 0) return null;
  const date = startOf(own, snapshot) ?? (ctx.weeks[0] as ISODate);
  const week = bucketOf(date, ctx.weeks) ?? 0;
  const trigger: CascadeTrigger = {
    kind: "growth",
    label: `Expected receipts grow by ${money(gain)} over the forecast from ${date}`,
    week,
    weekStart: ctx.weeks[week] as ISODate,
    date,
    amount: gain,
  };
  const months = Math.max(1, daysBetween(date, ctx.end) / 30.4);
  const perMonth = Number((BigInt(Math.round(gain / months)) * SUPPORT_HIRE_BPS) / 10_000n);
  const from = addDays(date, 30);
  const options: Option[] = [];
  if (perMonth > 0 && from <= ctx.end)
    options.push({
      event: "The company hires to support the growth",
      branchLabel: "Hire for growth",
      reason: `More customers need more support and delivery staff. Assumed new payroll of about 30% of the added monthly receipts (${money(perMonth)}/month) from a month later.`,
      likelihood: "Likely",
      changes: [
        {
          kind: "recurring_cash",
          label: unique(level.all, "Hiring to support growth"),
          direction: "out",
          amount: perMonth,
          fromDate: from,
          everyDays: 30,
        },
      ],
    });
  return { key: "growth", trigger, options };
}

// ---------- Helpers ----------

/** Non-critical unpaid bills due in [from, to] that no change has touched yet, largest first. */
function stretchableBills(ctx: Ctx, level: Level, from: ISODate, to: ISODate) {
  const touched = touchedBills(level.all);
  const live = new Set(level.schedule.items.filter((i) => i.kind === "bill").map((i) => i.id));
  return ctx.input.snapshot.bills
    .filter(
      (b) =>
        !b.paid &&
        !b.critical &&
        b.due >= from &&
        b.due <= to &&
        live.has(b.id) &&
        !touched.has(b.id),
    )
    .sort((a, b) => b.amount - a.amount || cmp(a.id, b.id))
    .slice(0, MAX_BILLS);
}

/** Expected 13-week collections by customer. */
function collections(schedule: CashSchedule, end: ISODate): Map<string, number> {
  const out = new Map<string, number>();
  for (const i of schedule.items) {
    if (i.customerId === undefined || i.amount <= 0 || i.date > end) continue;
    out.set(i.customerId, (out.get(i.customerId) ?? 0) + i.amount);
  }
  return out;
}

function drawsIn(changes: Change[]) {
  return changes.flatMap((c) =>
    c.kind === "add_cash" && DRAW_LABEL.test(c.label)
      ? [{ date: c.date, amount: c.amount, label: c.label }]
      : [],
  );
}

const touchedBills = (changes: Change[]) =>
  new Set(changes.flatMap((c) => (c.kind === "delay_bill" ? [c.billId] : [])));
const touchedInvoices = (changes: Change[]) =>
  new Set(
    changes.flatMap((c) =>
      c.kind === "delay_invoice" || c.kind === "lose_invoice" || c.kind === "discount_early_pay"
        ? [c.invoiceId]
        : [],
    ),
  );

/** Earliest date a change list can move cash (invoice and bill changes act from the due date). */
export function startOf(changes: Change[], snapshot: Snapshot): ISODate | null {
  let first: ISODate | null = null;
  for (const c of changes) {
    const d =
      c.kind === "add_cash" || c.kind === "remove_cash"
        ? c.date
        : c.kind === "churn"
          ? c.fromDate
          : c.kind === "discount_early_pay"
            ? c.payOn
            : c.kind === "shift_hire" ||
                c.kind === "delay_customer" ||
                c.kind === "recurring_cash" ||
                c.kind === "scale_recurring"
              ? c.fromDate
              : c.kind === "delay_bill"
                ? snapshot.bills.find((b) => b.id === c.billId)?.due
                : snapshot.invoices.find((i) => i.id === c.invoiceId)?.due;
    if (d !== undefined && (first === null || d < first)) first = d;
  }
  return first;
}

/** A label no change in `changes` uses yet (the engine keys added cash by label). */
export function unique(changes: Change[], label: string): string {
  const used = new Set(changes.flatMap((c) => ("label" in c ? [c.label] : [])));
  let out = label;
  for (let n = 2; used.has(out); n++) out = `${label} (${n})`;
  return out;
}

/** amount * bps/10000 * days/365, in whole cents. */
export function interest(amount: Cents, bps: bigint, days: number): Cents {
  if (amount <= 0 || days <= 0) return 0;
  return Number((BigInt(amount) * bps * BigInt(days) + 1_825_000n) / 3_650_000n);
}

function monthly(from: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= end; d = addDays(d, 30)) out.push(d);
  return out;
}

function sum(rows: { amount: number }[], negate = false): number {
  const total = rows.reduce((a, r) => a + r.amount, 0);
  return negate ? -total : total;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const maxDate = (a: ISODate, b: ISODate) => (a > b ? a : b);
const clampDate = (d: ISODate, lo: ISODate, hi: ISODate) => {
  const out = maxDate(d, lo);
  return out <= hi ? out : lo <= hi ? hi : null;
};

function sameCash(a: Forecast, b: Forecast): boolean {
  return a.weeks.every(
    (w, i) =>
      w.usable === b.weeks[i]?.usable &&
      w.inflow === b.weeks[i]?.inflow &&
      w.outflow === b.weeks[i]?.outflow,
  );
}
