import type { Change, CompanyModel, ISODate, Snapshot } from "@domino/contracts";
import { addDays, horizonEnd } from "./dates";
import { cashSchedule, forecast } from "./forecast";
import { ratio, roundCents } from "./money";
import { bucketOf } from "./schedule";

/**
 * How a company responds when a scenario leaves it short of cash: it cuts growth spending and
 * payroll (a hiring freeze), and that lower investment slows revenue after a lag: recurring
 * billing and new deals both shrink. Without this, a one-time loss only shifts the forecast
 * down; with it, less cash means less investment and less growth.
 *
 * Every number is a stated assumption on the policy, never inferred here. The engine turns the
 * policy into ordinary changes and computes every amount from the saved schedule: payroll
 * savings and lost deal cash are fractions of the scheduled runs and deals themselves.
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
  /** Percent cut to every payroll run (a hiring freeze or layoffs), 0-30. */
  payrollCutPercent: number;
  /** Days from the trigger until the cuts take effect, 0-60. */
  reactionDays: number;
  /** Percent of revenue lost per percent of total investment cut, 0-1. */
  growthSensitivity: number;
  /** Days from the cuts until revenue slows, 0-180. */
  revenueLagDays: number;
};

/** One labelled part of the response; screening keeps or drops a part whole. */
export type CashResponsePart = {
  part: "spend" | "payroll" | "billing" | "deals";
  note: string;
  changes: Change[];
};

export type CashResponse = {
  /** When the response was triggered, or null when it was not. */
  trigger: { date: ISODate; usable: number | null } | null;
  /** Cuts first, then the revenue slowdown they cause. */
  parts: CashResponsePart[];
};

const LIMITS = {
  spendCutPercent: [0, 60],
  payrollCutPercent: [0, 30],
  reactionDays: [0, 60],
  growthSensitivity: [0, 1],
  revenueLagDays: [0, 180],
} as const;
const MAX_SLOWDOWN = 60;

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

/** Percent with one decimal place, so every scaled amount stays an exact decimal. */
const tenth = (x: number) => Math.round(x * 10) / 10;
/** `percent` of `cents`, rounded once; percent has at most one decimal place. */
const share = (cents: number, percent: number) =>
  roundCents(ratio(BigInt(cents) * BigInt(Math.round(percent * 10)), 1000n));

export function cashResponseChanges(
  snapshot: Snapshot,
  model: CompanyModel,
  changes: Change[],
  policy: CashResponsePolicy,
): CashResponse {
  checkPolicy(policy);
  const schedule = cashSchedule(snapshot, model, changes);
  const plan = forecast(snapshot, model, changes);
  const end = horizonEnd(schedule.weeks);
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
  if (!trigger) return { trigger: null, parts: [] };
  const parts: CashResponsePart[] = [];
  const cutOn = addDays(trigger.date, policy.reactionDays);
  if (cutOn > end) return { trigger, parts };

  const spendCut = tenth(policy.spendCutPercent);
  const names = [...new Set(policy.growthSpend.map((n) => n.trim()).filter(Boolean))];
  if (spendCut > 0 && names.length)
    parts.push({
      part: "spend",
      note: `Cut ${names.join(", ")} by ${spendCut}% from ${cutOn}`,
      changes: [
        {
          kind: "scale_recurring",
          label: `Response: growth spending cut ${spendCut}%`,
          flows: "spend",
          names,
          percent: -spendCut,
          fromDate: cutOn,
        },
      ],
    });

  const payrollCut = tenth(policy.payrollCutPercent);
  // One saving per scheduled run keeps payroll's own rhythm in the line.
  const runs = schedule.items.filter(
    (i) => i.kind === "payroll" && i.date >= cutOn && i.date <= end && i.amount < 0,
  );
  const payroll = runs.flatMap((run): Change[] => {
    const saved = share(-run.amount, payrollCut);
    return saved > 0
      ? [
          {
            kind: "add_cash",
            date: run.date,
            amount: saved,
            label: `Response: payroll ${payrollCut}% lower, run ${run.id} on ${run.date}`,
          },
        ]
      : [];
  });
  if (payroll.length)
    parts.push({
      part: "payroll",
      note: `Payroll ${payrollCut}% lower from ${cutOn} (hiring freeze), ${payroll.length} runs`,
      changes: payroll,
    });

  // Revenue slows only if the company actually invests less.
  const invested = parts.length ? Math.min(MAX_SLOWDOWN, spendCut + payrollCut) : 0;
  const slower = tenth(invested * policy.growthSensitivity);
  const slowOn = addDays(cutOn, policy.revenueLagDays);
  if (slower <= 0 || slowOn > end) return { trigger, parts };
  parts.push({
    part: "billing",
    note: `Recurring billing ${slower}% lower from ${slowOn}`,
    changes: [
      {
        kind: "scale_recurring",
        label: `Response: slower growth, recurring billing ${slower}% lower`,
        flows: "billing",
        names: [],
        percent: -slower,
        fromDate: slowOn,
      },
    ],
  });
  // New deals close smaller or fewer; one change per week keeps the plan within its limits.
  const lost = new Map<number, number>();
  for (const deal of schedule.items)
    if (deal.kind === "deal" && deal.date >= slowOn && deal.date <= end && deal.amount > 0) {
      const week = bucketOf(deal.date, schedule.weeks);
      if (week !== null) lost.set(week, (lost.get(week) ?? 0) + share(deal.amount, slower));
    }
  const deals = [...lost.entries()]
    .filter(([, amount]) => amount > 0)
    .sort(([a], [b]) => a - b)
    .map(([week, amount]): Change => {
      const weekStart = schedule.weeks[week] ?? slowOn;
      const date = weekStart < slowOn ? slowOn : weekStart;
      return {
        kind: "remove_cash",
        date,
        amount,
        label: `Response: new deals ${slower}% smaller, week of ${weekStart}`,
      };
    });
  if (deals.length)
    parts.push({
      part: "deals",
      note: `New deals ${slower}% smaller from ${slowOn}`,
      changes: deals,
    });
  return { trigger, parts };
}
