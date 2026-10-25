import type { Change, CompanyModel, Constraint, Forecast, Snapshot } from "@domino/contracts";
import { type RuleResult, evaluateRules } from "@domino/engine/src/rules";
import { z } from "zod";
import { addDays, daysBetween, reject } from "./workspaceInput";

// TL1C rule receipts. Structured results come from the shared evaluator (read-only engine
// subpath), never from parsing domino prose. The parent is evaluated under the SAME rules, so
// a breach both plans share is pre-existing and no action is blamed for it.

export const RuleReceiptSchema = z
  .object({
    constraintId: z.string(),
    constraintVersion: z.string(),
    label: z.string(),
    kind: z.enum(["min_cash", "min_runway_months", "pay_by_date"]),
    status: z.enum(["breached", "clear", "beyond_horizon", "unable"]),
    relation: z.enum(["new", "pre_existing", "resolved", "clear", "outside_horizon", "unable"]),
    limit: z.number(),
    unit: z.enum(["cents", "months", "days"]),
    value: z.number().nullable(),
    shortfall: z.number().nullable(),
    date: z.string().nullable(),
    weekStart: z.string().nullable(),
    actionLabels: z.array(z.string()),
    evidence: z.array(z.string()),
  })
  .strict();
export type RuleReceipt = z.infer<typeof RuleReceiptSchema>;

/** One plan to evaluate: its forecast and the complete ordered changes behind it. */
export type Plan = { forecast: Forecast; changes: Change[] };

type Outcome = RuleResult | { constraint: Constraint; status: "unable"; reason: string };

/** Each rule on its own, so one rule the evaluator refuses cannot hide the others' results. */
function evaluate(snapshot: Snapshot, model: CompanyModel, plan: Plan, rules: Constraint[]) {
  return rules.map((constraint): Outcome => {
    try {
      const [result] = evaluateRules(snapshot, plan.forecast, [constraint], {
        model,
        changes: plan.changes,
      });
      if (!result) throw new Error("no result");
      return result;
    } catch {
      return { constraint, status: "unable", reason: "The rule could not be evaluated" };
    }
  });
}

const UNIT = { min_cash: "cents", min_runway_months: "months", pay_by_date: "days" } as const;

/** Plain label for a change, used to name the actions behind a new breach. */
export function changeLabel(change: Change): string {
  switch (change.kind) {
    case "add_cash":
    case "remove_cash":
    case "shift_hire":
      return change.label;
    case "delay_invoice":
      return `Invoice ${change.invoiceId} paid ${Math.abs(change.days)} days ${change.days > 0 ? "later" : "earlier"}`;
    case "lose_invoice":
      return `Invoice ${change.invoiceId} never paid`;
    case "discount_early_pay":
      return `Invoice ${change.invoiceId} paid early on ${change.payOn} at a discount`;
    case "delay_bill":
      return `Bill ${change.billId} paid ${Math.abs(change.days)} days ${change.days > 0 ? "later" : "earlier"}`;
    case "churn":
      return `Customer ${change.customerId} leaves from ${change.fromDate}`;
  }
}

/** Exact integer difference of two engine values; refuses rather than lose precision. */
function exactDiff(a: number, b: number): number {
  const d = a - b;
  if (!Number.isSafeInteger(d))
    reject("UNSAFE_MONEY", "A difference is too large to state exactly");
  return d;
}

function relationOf(status: Outcome["status"], parent: Outcome["status"] | null) {
  if (status === "unable") return "unable" as const;
  if (status === "beyond_horizon") return "outside_horizon" as const;
  if (status === "breached")
    return parent === "breached" || parent === null ? "pre_existing" : "new";
  return parent === "breached" ? "resolved" : "clear";
}

function receipt(
  outcome: Outcome,
  parent: Outcome | null,
  versionOf: (c: Constraint) => string,
  snapshot: Snapshot,
  plan: Plan,
  horizonEnd: string,
  ownChanges: Change[],
): RuleReceipt {
  const c = outcome.constraint;
  const relation = relationOf(outcome.status, parent?.status ?? null);
  const base: RuleReceipt = {
    constraintId: c.id,
    constraintVersion: versionOf(c),
    label: c.label,
    kind: c.kind,
    status: outcome.status,
    relation,
    limit: c.limit,
    unit: UNIT[c.kind],
    value: null,
    shortfall: null,
    date: null,
    weekStart: null,
    // Only a breach this scenario introduced is attributed to its own defined changes.
    actionLabels: relation === "new" ? ownChanges.map(changeLabel) : [],
    evidence: [`Rule source: ${c.evidence.source} ${c.evidence.ref} (${c.evidence.note})`],
  };
  if (parent?.status === "breached" && "breach" in parent && parent.breach)
    base.evidence.push(
      `The plan this one started from also breaks this rule on ${parent.breach.date}`,
    );
  if (outcome.status === "unable") {
    base.evidence.push(outcome.reason);
    return base;
  }
  const breach = "breach" in outcome ? outcome.breach : undefined;
  if (c.kind === "min_cash") {
    if (breach && breach.kind === "min_cash") {
      base.value = breach.usable;
      base.shortfall = exactDiff(c.limit, breach.usable);
      base.date = breach.date;
      base.weekStart = breach.weekStart;
      base.evidence.push(
        `Usable cash at the weekly close on Sunday ${breach.date} is below the limit (weekly closes only, not daily)`,
      );
    } else {
      base.value = plan.forecast.lowPoint.usable;
      base.weekStart = plan.forecast.lowPoint.weekStart;
      base.evidence.push(
        `No weekly close in the 13-week forecast is below the limit; lowest is the week of ${plan.forecast.lowPoint.weekStart}`,
      );
    }
    return base;
  }
  if (c.kind === "min_runway_months") {
    // The evaluator does not expose runway months, so no runway figure is stated.
    if (breach) {
      base.date = breach.date;
      base.weekStart = breach.weekStart;
      base.evidence.push(
        `Runway first falls below the limit at the weekly close on Sunday ${breach.date}, using 13-week net outflow`,
      );
    } else {
      base.evidence.push("Runway stays at or above the limit at every weekly close in 13 weeks");
    }
    return base;
  }
  const bill = snapshot.bills.find((b) => b.id === c.billId);
  if (!bill) return base;
  const deadline = addDays(bill.due, c.limit);
  base.date = deadline;
  base.evidence.push(
    `Bill ${bill.id} (${bill.vendor}), originally due ${bill.due}`,
    `Deadline ${deadline} (${c.limit} allowed late days)`,
  );
  if (outcome.status === "beyond_horizon") {
    base.evidence.push(`Deadline is after the forecast ends on ${horizonEnd}; not evaluated`);
  } else if (breach && breach.kind === "pay_by_date") {
    base.weekStart = breach.weekStart;
    if (breach.fundedOn) {
      base.value = daysBetween(bill.due, breach.fundedOn);
      base.shortfall = daysBetween(deadline, breach.fundedOn);
      base.evidence.push(`Projected funding on ${breach.fundedOn}, after the deadline`);
    } else {
      base.evidence.push(
        deadline <= snapshot.asOf
          ? "Unpaid and already past its deadline"
          : "Unpaid: not projected to be funded by the deadline",
      );
    }
  } else if (bill.paid !== undefined) {
    base.evidence.push(`Already paid on ${bill.paid}`);
  } else {
    base.evidence.push("Projected to be funded by the deadline");
  }
  return base;
}

/**
 * Receipts for `plan` under `rules`, compared with `parent` (null for the workspace root, whose
 * existing breaches are pre-existing) under the very same rules.
 */
export function ruleReceipts(args: {
  snapshot: Snapshot;
  model: CompanyModel;
  rules: Constraint[];
  versionOf: (c: Constraint) => string;
  plan: Plan;
  parent: Plan | null;
  ownChanges: Change[];
  horizonEnd: string;
}): RuleReceipt[] {
  const { snapshot, model, rules, plan, parent } = args;
  const mine = evaluate(snapshot, model, plan, rules);
  const theirs = parent ? evaluate(snapshot, model, parent, rules) : null;
  return mine.map((outcome, i) =>
    receipt(
      outcome,
      theirs?.[i] ?? null,
      args.versionOf,
      snapshot,
      plan,
      args.horizonEnd,
      args.ownChanges,
    ),
  );
}
