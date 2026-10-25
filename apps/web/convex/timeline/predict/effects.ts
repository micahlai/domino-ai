import type { Change, Forecast } from "@domino/contracts";
import { cashYieldChanges, engine } from "@domino/engine";
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

export type Prediction = {
  /** Effects then interest, in the order they are applied on top of the scenario. */
  changes: Change[];
  interest: { annualBps: number; weeks: number; netCents: number } | null;
  warnings: string[];
  forecast: Forecast;
};

/**
 * The predicted line: the scenario, its accepted knock-on effects, then the interest the
 * resulting cash gap to the scenario's parent gains or loses. The engine computes all of it.
 */
export function predict(
  run: WorkspaceRun,
  parent: Forecast,
  floor: string | null,
  effects: AcceptedEffect[],
): Prediction {
  const snapshot = run.baseline.seed.snapshot;
  const model = run.baseline.model;
  const own = effects.map((e) => e.change);
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
