import type { Change, CompanyModel, ISODate, Snapshot } from "@domino/contracts";
import { addDays, horizonEnd } from "./dates";
import { forecast } from "./forecast";

/**
 * How a company responds when a scenario leaves it short of cash: it cuts growth spending,
 * and that lower investment slows recurring billing after a lag. Without this, a one-time
 * loss only shifts the forecast down; with it, less cash means less investment and less growth.
 *
 * Every number is a stated assumption on the policy, never inferred here. The engine turns the
 * policy into ordinary scale_recurring changes, so every cent is computed the same way as any
 * other what-if.
 */
export type CashResponsePolicy = {
  /**
   * "breach": respond the first week usable cash falls below `floor` on or after `notBefore`.
   * "event": respond from `notBefore` (the event) whether or not a floor is crossed.
   */
  respondFrom: "breach" | "event";
  /** Usable-cash floor in cents (the lowest cash rule); required for "breach". */
  floor: number | null;
  /** The event date: no response can start before it. */
  notBefore: ISODate;
  /** Spend names (bill vendors or recurring spend labels) treated as growth spending. */
  growthSpend: string[];
  /** Percent cut to growth spending, 0-60. */
  spendCutPercent: number;
  /** Days from the trigger until the cut takes effect, 0-60. */
  reactionDays: number;
  /** Percent of lost recurring billing per percent of spending cut, 0-1. */
  growthSensitivity: number;
  /** Days from the cut until billing slows, 0-180. */
  revenueLagDays: number;
};

export type CashResponse = {
  /** Week the response was triggered, or null when it was not. */
  trigger: { date: ISODate; usable: number | null } | null;
  changes: Change[];
  /** Plain-words notes, one per change, in the same order. */
  notes: string[];
};

const LIMITS = {
  spendCutPercent: [0, 60],
  reactionDays: [0, 60],
  growthSensitivity: [0, 1],
  revenueLagDays: [0, 180],
} as const;

function checkPolicy(p: CashResponsePolicy) {
  for (const [key, [min, max]] of Object.entries(LIMITS)) {
    const value = p[key as keyof typeof LIMITS];
    if (!Number.isFinite(value) || value < min || value > max)
      throw new Error(`cash response ${key} must be between ${min} and ${max}, got ${value}`);
  }
  if (!Number.isInteger(p.reactionDays) || !Number.isInteger(p.revenueLagDays))
    throw new Error("cash response delays must be whole days");
  if (p.respondFrom === "breach" && p.floor === null)
    throw new Error("a breach response needs a cash floor");
}

/** Percent with one decimal place, so scale_recurring stays an exact decimal. */
const tenth = (x: number) => Math.round(x * 10) / 10;

export function cashResponseChanges(
  snapshot: Snapshot,
  model: CompanyModel,
  changes: Change[],
  policy: CashResponsePolicy,
): CashResponse {
  checkPolicy(policy);
  const none: CashResponse = { trigger: null, changes: [], notes: [] };
  const plan = forecast(snapshot, model, changes);
  const end = horizonEnd(plan.weeks.map((w) => w.weekStart));
  let trigger: CashResponse["trigger"] = null;
  if (policy.respondFrom === "event") {
    trigger = { date: policy.notBefore, usable: null };
  } else {
    const floor = policy.floor ?? 0;
    // A week counts once it ends on or after the event, so a mid-week event can trigger it.
    const week = plan.weeks.find(
      (w) => addDays(w.weekStart, 6) >= policy.notBefore && w.usable < floor,
    );
    if (week)
      trigger = {
        date: week.weekStart < policy.notBefore ? policy.notBefore : week.weekStart,
        usable: week.usable,
      };
  }
  if (!trigger) return none;
  const out: Change[] = [];
  const notes: string[] = [];
  const cutOn = addDays(trigger.date, policy.reactionDays);
  const cut = tenth(policy.spendCutPercent);
  const names = [...new Set(policy.growthSpend.map((n) => n.trim()).filter(Boolean))];
  if (cut > 0 && names.length && cutOn <= end) {
    out.push({
      kind: "scale_recurring",
      label: `Response: growth spending cut ${cut}%`,
      flows: "spend",
      names,
      percent: -cut,
      fromDate: cutOn,
    });
    notes.push(`Cut ${names.join(", ")} by ${cut}% from ${cutOn}`);
    const slowOn = addDays(cutOn, policy.revenueLagDays);
    const slower = tenth(cut * policy.growthSensitivity);
    if (slower > 0 && slowOn <= end) {
      out.push({
        kind: "scale_recurring",
        label: `Response: slower growth after the spending cut, billing ${slower}% lower`,
        flows: "billing",
        names: [],
        percent: -slower,
        fromDate: slowOn,
      });
      notes.push(`Recurring billing ${slower}% lower from ${slowOn} after the cut`);
    }
  }
  return { trigger, changes: out, notes };
}
