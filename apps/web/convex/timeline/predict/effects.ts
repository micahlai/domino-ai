import type { Change, Forecast } from "@domino/contracts";
import {
  type CashResponsePolicy,
  cashResponseChanges,
  cashYieldChanges,
  engine,
} from "@domino/engine";
import { ConvexError } from "convex/values";
import { z } from "zod";
import type { WorkspaceRun } from "../questions/context";
import { changeStart } from "../scenarioStart";
import {
  type Horizon,
  MAX_TOTAL_CHANGES,
  checkChanges,
  checkEffects,
  checkMoneyBound,
} from "../workspaceInput";

/**
 * Knock-on effects an agent may predict. Each names a saved record and never an amount: the
 * engine derives every cent from the record (Hard rule 6). Company decisions (delaying its own
 * bills, borrowing) are responses, not predictions, so they are not offered here.
 */
export const EFFECT_KINDS = ["churn", "lose_invoice", "delay_invoice"] as const;
export const MAX_EFFECTS = 8;
const MAX_DELAY_DAYS = 120;
/** Assumed yield on cash and short-term investments, shown wherever the result is. */
export const CASH_YIELD_BPS = 450;

export const ProposedEffectSchema = z
  .object({
    kind: z.enum(EFFECT_KINDS),
    recordId: z.string().min(1).max(240),
    days: z.number().int().nullable(),
    fromDate: z.string().nullable(),
    title: z.string().trim().min(1).max(160),
    reason: z.string().trim().min(1).max(600),
    likelihood: z.enum(["likely", "possible"]),
    evidence: z.array(z.string().trim().min(1).max(300)).max(4),
  })
  .strict();
export type ProposedEffect = z.infer<typeof ProposedEffectSchema>;

export type AcceptedEffect = Omit<ProposedEffect, "kind" | "recordId" | "days" | "fromDate"> & {
  change: Change;
};
export type Screened = {
  accepted: AcceptedEffect[];
  rejected: { title: string; reason: string }[];
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function horizonOf(run: WorkspaceRun): Horizon {
  const weeks = run.baseline.forecast.weeks;
  const first = weeks[0]?.weekStart;
  const last = weeks[weeks.length - 1]?.weekStart;
  if (!first || !last) throw new Error("Saved baseline has no forecast weeks");
  const end = new Date(`${last}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  return {
    asOf: run.baseline.seed.snapshot.asOf,
    firstWeek: first,
    end: end.toISOString().slice(0, 10),
  };
}

/** The engine change for one proposal, or why it cannot be one. */
function toChange(effect: ProposedEffect, run: WorkspaceRun): Change | string {
  const snapshot = run.baseline.seed.snapshot;
  switch (effect.kind) {
    case "churn": {
      if (!snapshot.customers.some((c) => c.id === effect.recordId))
        return `No customer ${effect.recordId} in these books`;
      if (!effect.fromDate || !ISO.test(effect.fromDate)) return "A churn needs a from date";
      return { kind: "churn", customerId: effect.recordId, fromDate: effect.fromDate };
    }
    case "lose_invoice":
    case "delay_invoice": {
      if (!snapshot.invoices.some((i) => i.id === effect.recordId))
        return `No invoice ${effect.recordId} in these books`;
      if (effect.kind === "lose_invoice")
        return { kind: "lose_invoice", invoiceId: effect.recordId };
      if (effect.days === null || effect.days < 1 || effect.days > MAX_DELAY_DAYS)
        return `A late payment needs 1 to ${MAX_DELAY_DAYS} days`;
      return { kind: "delay_invoice", invoiceId: effect.recordId, days: effect.days };
    }
  }
}

const target = (c: Change) =>
  c.kind === "churn"
    ? `customer:${c.customerId}`
    : c.kind === "delay_invoice" || c.kind === "lose_invoice" || c.kind === "discount_early_pay"
      ? `invoice:${c.invoiceId}`
      : c.kind === "delay_bill"
        ? `bill:${c.billId}`
        : null;

const message = (e: unknown) =>
  e instanceof ConvexError
    ? String((e.data as { message?: unknown })?.message ?? "Rejected by the engine checks")
    : e instanceof Error
      ? e.message
      : "Rejected by the engine checks";

/**
 * Keeps the proposals the engine accepts on top of the scenario, in order, with the same
 * checks a saved run must pass. `floor` is the earliest date a branch of this scenario may
 * start: an effect cannot come before the event that causes it.
 */
export function screenEffects(
  run: WorkspaceRun,
  floor: string | null,
  proposed: ProposedEffect[],
): Screened {
  const snapshot = run.baseline.seed.snapshot;
  const model = run.baseline.model;
  const horizon = horizonOf(run);
  const accepted: AcceptedEffect[] = [];
  const rejected: Screened["rejected"] = [];
  const taken = new Set(run.changes.map(target).filter((t) => t !== null));
  for (const effect of proposed) {
    const reject = (reason: string) => rejected.push({ title: effect.title, reason });
    if (accepted.length >= MAX_EFFECTS) {
      reject(`Only the first ${MAX_EFFECTS} effects are used`);
      continue;
    }
    const change = toChange(effect, run);
    if (typeof change === "string") {
      reject(change);
      continue;
    }
    const key = target(change);
    if (key && taken.has(key)) {
      reject("This record is already changed by the scenario or an earlier effect");
      continue;
    }
    const start = changeStart(change, snapshot);
    if (floor !== null && start !== null && start < floor) {
      reject(`It would start ${start}, before the scenario's event on ${floor}`);
      continue;
    }
    const changes = [...run.changes, ...accepted.map((a) => a.change), change];
    try {
      checkChanges(changes, snapshot, horizon);
      checkEffects(changes, snapshot, model, horizon);
      checkMoneyBound(snapshot, model, run.constraints, changes);
    } catch (e) {
      reject(message(e));
      continue;
    }
    if (key) taken.add(key);
    const { kind: _k, recordId: _r, days: _d, fromDate: _f, ...shown } = effect;
    accepted.push({ ...shown, change });
  }
  return { accepted, rejected };
}

/**
 * How management would respond to being shorter of cash. The agents choose the parameters for
 * this company within the engine's bounds; without them, DEFAULT_RESPONSE applies. The engine
 * turns the policy into spending and billing changes (packages/engine/src/cash-response.ts).
 */
export const ProposedResponseSchema = z
  .object({
    respondFrom: z.enum(["breach", "event"]),
    growthSpend: z.array(z.string().trim().min(1).max(200)).max(12),
    spendCutPercent: z.number().min(0).max(60),
    payrollCutPercent: z.number().min(0).max(30),
    reactionDays: z.number().int().min(0).max(60),
    growthSensitivity: z.number().min(0).max(1),
    revenueLagDays: z.number().int().min(0).max(180),
    likelihood: z.enum(["likely", "possible"]),
    reason: z.string().trim().min(1).max(600),
    evidence: z.array(z.string().trim().min(1).max(300)).max(4),
  })
  .strict();
export type ProposedResponse = z.infer<typeof ProposedResponseSchema>;

/** Spending that usually buys growth rather than keeping the lights on. */
const GROWTH_WORDS =
  /\b(campaigns?|marketing|advertis\w*|ads?|sales|sponsor\w*|events?|travel|growth|brand\w*|promotion\w*)\b/i;

/** Conservative stand-in when no agent answers. Every number is a labelled assumption. */
export const DEFAULT_RESPONSE = {
  respondFrom: "breach",
  spendCutPercent: 20,
  payrollCutPercent: 5,
  reactionDays: 14,
  growthSensitivity: 0.25,
  revenueLagDays: 56,
  likelihood: "possible",
  reason:
    "Default assumption: once usable cash falls below the lowest cash rule, management cuts growth spending by 20% and freezes hiring (payroll 5% lower) two weeks later; eight weeks after that, recurring billing and new deals are a quarter of the total cut lower.",
  evidence: [],
} as const;

/** Bill vendors and recurring spend labels a response can name, as the engine matches them. */
export function spendNames(run: WorkspaceRun): string[] {
  const { snapshot } = run.baseline.seed;
  const open = snapshot.bills
    .filter((b) => b.paid === undefined && !b.critical)
    .map((b) => b.vendor);
  const recurring = run.baseline.model.recurringSpend.map((r) => r.label);
  return [...new Set([...open, ...recurring])].sort();
}

/** The cash rule a response reacts to: the highest minimum, so the first one crossed. */
export function cashFloor(run: WorkspaceRun): number | null {
  const limits = run.constraints.filter((c) => c.kind === "min_cash").map((c) => c.limit);
  return limits.length ? Math.max(...limits) : null;
}

export type ScreenedResponse = {
  source: "agents" | "default";
  policy: CashResponsePolicy;
  likelihood: "likely" | "possible";
  reason: string;
  evidence: string[];
  trigger: { date: string; usable: number | null } | null;
  notes: string[];
  changes: Change[];
  /** Why nothing was applied, when nothing was. */
  skipped: string | null;
};

/**
 * Builds the response on top of the scenario and its effects with the engine, and keeps it only
 * if it passes the checks every saved run passes. Unknown spend names are dropped and listed.
 */
export function screenResponse(
  run: WorkspaceRun,
  floor: string | null,
  effects: Change[],
  proposed: ProposedResponse | null,
): ScreenedResponse {
  const snapshot = run.baseline.seed.snapshot;
  const model = run.baseline.model;
  const known = new Map(spendNames(run).map((n) => [n.toLowerCase(), n]));
  const source = proposed ? "agents" : "default";
  const chosen = proposed ?? {
    ...DEFAULT_RESPONSE,
    growthSpend: spendNames(run).filter((n) => GROWTH_WORDS.test(n)),
    evidence: [] as string[],
  };
  const names = chosen.growthSpend.flatMap((n) => known.get(n.toLowerCase()) ?? []);
  const unknown = chosen.growthSpend.filter((n) => !known.has(n.toLowerCase()));
  const policy: CashResponsePolicy = {
    respondFrom: chosen.respondFrom,
    floor: cashFloor(run),
    notBefore: floor ?? horizonOf(run).firstWeek,
    growthSpend: names,
    spendCutPercent: chosen.spendCutPercent,
    payrollCutPercent: chosen.payrollCutPercent,
    reactionDays: chosen.reactionDays,
    growthSensitivity: chosen.growthSensitivity,
    revenueLagDays: chosen.revenueLagDays,
  };
  const base: Omit<ScreenedResponse, "trigger" | "notes" | "changes" | "skipped"> = {
    source,
    policy,
    likelihood: chosen.likelihood,
    reason: chosen.reason,
    evidence: [...chosen.evidence],
  };
  const skip = (skipped: string): ScreenedResponse => ({
    ...base,
    trigger: null,
    notes: unknown.length ? [`Not in these books: ${unknown.join(", ")}`] : [],
    changes: [],
    skipped,
  });
  if (!names.length && chosen.payrollCutPercent <= 0)
    return skip("No growth spending or payroll cut was chosen, so nothing was cut.");
  if (policy.respondFrom === "breach" && policy.floor === null)
    return skip("These books have no cash rule to cross, so no response was triggered.");
  const prior = [...run.changes, ...effects];
  let built: ReturnType<typeof cashResponseChanges>;
  try {
    built = cashResponseChanges(snapshot, model, prior, policy);
  } catch (e) {
    return skip(message(e));
  }
  if (!built.trigger)
    return skip("Cash stays above the lowest cash rule, so management has no reason to cut.");
  if (!built.parts.length) return skip("The response would start after the forecast ends.");
  // Keep a part only if it moves cash: books without billing plans or deals have nothing to
  // slow, and a cut dated after the last growth bill saves nothing. Revenue slows only after a
  // cut that was kept.
  const horizon = horizonOf(run);
  const kept: Change[] = [];
  const notes: string[] = [];
  let cutKept = false;
  for (const part of built.parts) {
    const isCut = part.part === "spend" || part.part === "payroll";
    if (!isCut && !cutKept) continue;
    const all = [...prior, ...kept, ...part.changes];
    try {
      checkChanges(all, snapshot, horizon);
      checkEffects(all, snapshot, model, horizon);
      checkMoneyBound(snapshot, model, run.constraints, all);
      kept.push(...part.changes);
      notes.push(part.note);
      if (isCut) cutKept = true;
    } catch (e) {
      notes.push(`Left out (${part.part}): ${message(e)}`);
    }
  }
  if (unknown.length) notes.push(`Not in these books: ${unknown.join(", ")}`);
  if (!kept.length)
    return { ...skip("Nothing the response cuts has payments left after the cut date."), notes };
  return { ...base, trigger: built.trigger, notes, changes: kept, skipped: null };
}

export type Prediction = {
  /** Effects, then the response, then interest, in the order they apply on top of the scenario. */
  changes: Change[];
  interest: { annualBps: number; weeks: number; netCents: number } | null;
  warnings: string[];
  forecast: Forecast;
};

/**
 * The predicted line: the scenario, its accepted knock-on effects, management's response to the
 * cash they leave, then the interest the resulting cash gap to the scenario's parent gains or
 * loses. The engine computes all of it.
 */
export function predict(
  run: WorkspaceRun,
  parent: Forecast,
  floor: string | null,
  effects: AcceptedEffect[],
  response: ScreenedResponse | null = null,
): Prediction {
  const snapshot = run.baseline.seed.snapshot;
  const model = run.baseline.model;
  const own = [...effects.map((e) => e.change), ...(response?.changes ?? [])];
  const withEffects = engine.forecast(snapshot, model, [...run.changes, ...own]);
  const warnings: string[] = [];
  let interest = cashYieldChanges(parent, withEffects, CASH_YIELD_BPS).filter((c) => {
    const start = changeStart(c, snapshot);
    return floor === null || start === null || start >= floor;
  });
  if (run.changes.length + own.length + interest.length > MAX_TOTAL_CHANGES) {
    warnings.push("Interest on cash was left out: the plan already holds too many changes.");
    interest = [];
  }
  const changes = [...own, ...interest];
  const netCents = interest.reduce(
    (sum, c) => sum + (c.kind === "add_cash" ? c.amount : c.kind === "remove_cash" ? -c.amount : 0),
    0,
  );
  return {
    changes,
    interest: interest.length
      ? { annualBps: CASH_YIELD_BPS, weeks: interest.length, netCents }
      : null,
    warnings,
    forecast: engine.forecast(snapshot, model, [...run.changes, ...changes]),
  };
}
