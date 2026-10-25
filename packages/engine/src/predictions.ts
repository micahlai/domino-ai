import type { Change, CompanyModel, ISODate, Snapshot } from "@domino/contracts";

import { addDays, daysBetween, horizonEnd } from "./dates";
import { money } from "./dominoes";
import { atRiskCustomers, effective, topCustomers } from "./external-events";
import { cashSchedule } from "./forecast";
import type { CashItem } from "./schedule";

/**
 * Predicted consequences of an event described in words ("public sentiment is up after our
 * launch", "we get a big investment", "a competitor collapses"), pure and deterministic. One
 * shared catalog of consequence kinds, each with parameters bounded by the company's own books
 * (plan sizes, cash, payroll). An estimator (Claude) or the rule defaults pick kinds, bounded
 * parameters, a start offset and a probability; this module clamps every value again and builds
 * ordinary Changes. It never computes a forecast: the engine does that like for any change list.
 */
export const PREDICTIONS_VERSION = "predictions@1.0.0";

export type PredictionKind =
  | "new_customers"
  | "billing_growth"
  | "funding_round"
  | "pipeline_acceleration"
  | "hiring_wave"
  | "churn_increase"
  | "slower_collections"
  | "pipeline_slowdown"
  | "one_time_cost";
export type PredictionParamName =
  | "count"
  | "avgMonthlyBilling"
  | "percent"
  | "amount"
  | "days"
  | "headcount"
  | "costPerHead";
export type PredictionParam = {
  name: PredictionParamName;
  unit: "count" | "cents" | "percent" | "days";
  min: number;
  max: number;
  default: number;
  meaning: string;
};
export type PredictionCatalogEntry = {
  kind: PredictionKind;
  title: string;
  meaning: string;
  /** Good news for cash (more customers, money in) versus bad news */
  good: boolean;
  params: PredictionParam[];
};
export type PredictionChoice = {
  kind: PredictionKind;
  params: Partial<Record<PredictionParamName, number>>;
  /** Days after the event starts that this consequence begins */
  startInDays: number;
  probability: number;
  reason: string;
  /** Parameters the person gave; they win over any estimate or bound */
  personal?: PredictionParamName[];
};
export type PredictedConsequence = {
  choice: PredictionChoice;
  title: string;
  startDate: ISODate;
  /** One plain line with the values used */
  effect: string;
  /** Empty when the consequence would not move cash inside the forecast */
  changes: Change[];
};

export const MAX_PREDICTIONS = 6;
export const MAX_START_DAYS = 90;
const MAX_PAYERS = 8;
const MAX_DEALS = 4;
const DAY_MONTH = 30.4;
const round = (cents: number, step: number) => Math.max(step, Math.round(cents / step) * step);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[Math.floor(s.length / 2)] as number) : 0;
};
/** A label no change in `changes` uses yet (the engine keys added cash by label). */
function unique(changes: Change[], label: string): string {
  const used = new Set(changes.flatMap((c) => ("label" in c ? [c.label] : [])));
  let out = label;
  for (let n = 2; used.has(out); n++) out = `${label.slice(0, 190)} (${n})`;
  return out;
}
const isReceipt = (i: CashItem) => i.kind === "invoice" || i.kind === "deal" || i.kind === "plan";

/** Company facts the bounds come from, in cents. */
function facts(snapshot: Snapshot, model: CompanyModel, prior: Change[]) {
  const schedule = cashSchedule(snapshot, model, prior);
  const end = horizonEnd(schedule.weeks);
  const plans = (snapshot.billingPlans ?? []).map((p) => Math.round(p.amount / p.everyMonths));
  const sizes = plans.length ? plans : snapshot.invoices.map((i) => i.amount).filter((a) => a > 0);
  const days = Math.max(1, daysBetween(snapshot.asOf, end));
  const future = -schedule.items
    .filter((i) => i.kind === "payroll" && i.date > snapshot.asOf && i.date <= end)
    .reduce((s, i) => s + i.amount, 0);
  const recent = snapshot.payroll
    .filter((p) => p.date > addDays(snapshot.asOf, -91) && p.date <= snapshot.asOf)
    .reduce((s, p) => s + p.amount, 0);
  const payroll = future > 0 ? Math.round((future * DAY_MONTH) / days) : Math.round(recent / 3);
  return {
    schedule,
    end,
    sizes,
    customers: snapshot.customers.length,
    cash: Math.max(0, snapshot.cashOnHand - snapshot.restrictedCash),
    payroll,
    terms: median(snapshot.customers.map((c) => c.paymentTermsDays)),
  };
}

/** The catalog with bounds from this company's own books; kinds the books cannot size are left out. */
export function predictionCatalog(
  snapshot: Snapshot,
  model: CompanyModel,
  prior: Change[] = [],
): PredictionCatalogEntry[] {
  const f = facts(snapshot, model, prior);
  const out: PredictionCatalogEntry[] = [];
  if (f.sizes.length) {
    const lo = Math.min(...f.sizes);
    const hi = Math.max(...f.sizes);
    out.push({
      kind: "new_customers",
      title: "New customers",
      meaning: "new customers start paying a recurring monthly bill, sized like current plans",
      good: true,
      params: [
        {
          name: "count",
          unit: "count",
          min: 1,
          max: Math.min(50, Math.max(3, f.customers * 2)),
          default: Math.max(1, Math.round(f.customers / 10)),
          meaning: "number of new customers",
        },
        {
          name: "avgMonthlyBilling",
          unit: "cents",
          min: lo,
          max: hi,
          default: median(f.sizes),
          meaning: "average monthly bill per new customer, within current plan sizes",
        },
      ],
    });
  }
  if (f.schedule.items.some((i) => i.kind === "plan"))
    out.push(
      {
        kind: "billing_growth",
        title: "Existing customers expand",
        meaning: "recurring billing from current customers grows (upsell, more seats)",
        good: true,
        params: [
          {
            name: "percent",
            unit: "percent",
            min: 1,
            max: 30,
            default: 5,
            meaning: "percent growth",
          },
        ],
      },
      {
        kind: "churn_increase",
        title: "More customers cancel",
        meaning: "the most at-risk customers cancel at their next renewal",
        good: false,
        params: [
          {
            name: "percent",
            unit: "percent",
            min: 1,
            max: 25,
            default: 5,
            meaning: "percent of recurring revenue that cancels",
          },
        ],
      },
    );
  if (f.cash > 0)
    out.push({
      kind: "funding_round",
      title: "Funding round",
      meaning: "investors put new money in, in one transfer",
      good: true,
      params: [
        {
          name: "amount",
          unit: "cents",
          min: round(f.cash / 10, 1_000_000),
          max: round(f.cash * 2, 1_000_000),
          default: round(f.cash / 2, 1_000_000),
          meaning: "amount raised, 0.1x to 2x current usable cash",
        },
      ],
    });
  out.push(
    {
      kind: "pipeline_acceleration",
      title: "Deals close faster",
      meaning: "signed new-deal payments arrive sooner",
      good: true,
      params: [
        { name: "days", unit: "days", min: 3, max: 45, default: 14, meaning: "days sooner" },
      ],
    },
    {
      kind: "pipeline_slowdown",
      title: "Deals close slower",
      meaning: "signed new-deal payments arrive later",
      good: false,
      params: [{ name: "days", unit: "days", min: 3, max: 45, default: 21, meaning: "days later" }],
    },
    {
      kind: "slower_collections",
      title: "Slower collections",
      meaning: "the largest payers pay later than usual",
      good: false,
      params: [
        { name: "days", unit: "days", min: 3, max: 45, default: 10, meaning: "days slower" },
      ],
    },
  );
  if (f.payroll > 0) {
    const perHead = Math.min(
      f.payroll * 12,
      Math.max(6_000_000, Math.min(20_000_000, (f.payroll * 12) / 20)),
    );
    out.push({
      kind: "hiring_wave",
      title: "Hiring to support growth",
      meaning: "new hires join payroll, paid monthly from their start",
      good: false,
      params: [
        {
          name: "headcount",
          unit: "count",
          min: 1,
          max: 50,
          default: 3,
          meaning: "number of new hires",
        },
        {
          name: "costPerHead",
          unit: "cents",
          min: Math.min(4_000_000, f.payroll * 12),
          max: Math.min(40_000_000, f.payroll * 12),
          default: round(perHead, 100_000),
          meaning: "yearly cost per hire, at most the current yearly payroll",
        },
      ],
    });
  }
  if (f.cash > 0)
    out.push({
      kind: "one_time_cost",
      title: "One-time cost",
      meaning: "a one-time payment such as legal, remediation or launch costs",
      good: false,
      params: [
        {
          name: "amount",
          unit: "cents",
          min: round(f.cash / 1_000, 100_000),
          max: round(f.cash / 4, 100_000),
          default: round(f.cash / 50, 100_000),
          meaning: "amount, 0.1% to 25% of current usable cash",
        },
      ],
    });
  return out;
}

const MONEY_IN_TEXT = /\$|\b\d[\d,.]*\s*(?:k|m|bn|mm|thousand|million|billion)\b/i;

/**
 * Read `{ consequences: [{ kind, params, startInDays, probability, reason }] }`: catalog kinds
 * only, one per kind, at most six; every parameter clamped to its bounds unless the person gave
 * it (`overrides`, positive whole numbers); probabilities kept in (0, 1]. Null when unusable.
 */
export function resolvePredictions(
  catalog: PredictionCatalogEntry[],
  raw: unknown,
  overrides: Partial<Record<PredictionParamName, number>> = {},
): PredictionChoice[] | null {
  const list =
    raw &&
    typeof raw === "object" &&
    Array.isArray((raw as { consequences?: unknown }).consequences)
      ? (raw as { consequences: unknown[] }).consequences
      : [];
  const out: PredictionChoice[] = [];
  for (const r of list) {
    if (!r || typeof r !== "object" || out.length >= MAX_PREDICTIONS) continue;
    const row = r as Record<string, unknown>;
    const entry = catalog.find((c) => c.kind === row.kind);
    if (!entry || out.some((o) => o.kind === entry.kind)) continue;
    const p =
      typeof row.probability === "number" && Number.isFinite(row.probability) ? row.probability : 0;
    if (p <= 0) continue;
    const given = (row.params && typeof row.params === "object" ? row.params : {}) as Record<
      string,
      unknown
    >;
    const params: PredictionChoice["params"] = {};
    const personal: PredictionParamName[] = [];
    for (const b of entry.params) {
      const mine = overrides[b.name];
      if (typeof mine === "number" && Number.isSafeInteger(mine) && mine > 0) {
        params[b.name] = mine;
        personal.push(b.name);
        continue;
      }
      const v = given[b.name];
      const value = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : b.default;
      params[b.name] = Math.min(b.max, Math.max(b.min, value));
    }
    const offset =
      typeof row.startInDays === "number" && Number.isFinite(row.startInDays)
        ? Math.round(row.startInDays)
        : 0;
    const said = typeof row.reason === "string" ? row.reason.trim().slice(0, 160) : "";
    out.push({
      kind: entry.kind,
      params,
      startInDays: Math.min(MAX_START_DAYS, Math.max(0, offset)),
      probability: Math.round(Math.min(1, p) * 100) / 100,
      // A reason is words only; the engine states every amount.
      reason: said && !MONEY_IN_TEXT.test(said) ? said : entry.meaning,
      ...(personal.length ? { personal } : {}),
    });
  }
  return out.length ? out : null;
}

export type EventTone = "positive" | "negative" | "funding";

/** Stated defaults when no estimator answers: typical consequences for the event's tone. */
export function rulePredictions(
  tone: EventTone,
  catalog: PredictionCatalogEntry[],
  overrides: Partial<Record<PredictionParamName, number>> = {},
): PredictionChoice[] | null {
  const picks: [PredictionKind, number, number, string][] =
    tone === "funding"
      ? [
          ["funding_round", 0.6, 30, "Investor interest usually closes a round within weeks"],
          ["hiring_wave", 0.5, 60, "New money usually funds hiring a month or two later"],
        ]
      : tone === "positive"
        ? [
            ["new_customers", 0.5, 30, "Good news usually brings new customers within a month"],
            ["pipeline_acceleration", 0.4, 0, "Open deals tend to close sooner on good news"],
          ]
        : [
            ["churn_increase", 0.4, 30, "Bad news usually makes at-risk customers cancel"],
            ["slower_collections", 0.4, 0, "Customers tend to pay slower after bad news"],
            ["pipeline_slowdown", 0.4, 0, "Prospects hesitate after bad news"],
          ];
  return resolvePredictions(
    catalog,
    {
      consequences: picks.map(([kind, probability, startInDays, reason]) => ({
        kind,
        probability,
        startInDays,
        params: {},
        reason: `Rule-based default: ${reason}`,
      })),
    },
    overrides,
  );
}

/** "AI prediction 70%" or "Rule-based prediction 50%". */
export const predictionTag = (source: "ai" | "rule", probability: number) =>
  `${source === "ai" ? "AI prediction" : "Rule-based prediction"} ${Math.round(probability * 100)}%`;

/**
 * Build each consequence on top of the earlier ones, in order. Changes that would not move
 * expected cash inside the forecast are dropped (the consequence is kept with no changes).
 */
export function buildPredictions(
  snapshot: Snapshot,
  model: CompanyModel,
  prior: Change[],
  choices: PredictionChoice[],
  eventStart: ISODate,
  /** Tags labels "AI prediction 70%"; null leaves them plain (a cascade names its own source) */
  source: "ai" | "rule" | null,
): PredictedConsequence[] {
  const out: PredictedConsequence[] = [];
  const taken = [...prior];
  for (const choice of choices) {
    const f = facts(snapshot, model, taken);
    const first = eventStart > snapshot.asOf ? eventStart : addDays(snapshot.asOf, 1);
    const start = addDays(first, choice.startInDays);
    const built = start > f.end ? null : buildOne(snapshot, model, f, taken, choice, start, source);
    const changes = built ? effective(snapshot, model, taken, built.changes, f.end) : [];
    taken.push(...changes);
    out.push({
      choice,
      title: built?.title ?? choice.kind,
      startDate: start,
      effect: built?.effect ?? `Starts ${start}, after these 13 weeks`,
      changes,
    });
  }
  return out;
}

function buildOne(
  snapshot: Snapshot,
  model: CompanyModel,
  f: ReturnType<typeof facts>,
  taken: Change[],
  c: PredictionChoice,
  start: ISODate,
  source: "ai" | "rule" | null,
): { title: string; effect: string; changes: Change[] } | null {
  const tag = source ? `${predictionTag(source, c.probability)}: ` : "";
  const p = c.params;
  const label = (text: string) => unique(taken, `${tag}${text}`.slice(0, 200));
  const receipts = f.schedule.items.filter(
    (i) => isReceipt(i) && i.amount > 0 && i.date >= start && i.date <= f.end,
  );
  const name = (id: string) => snapshot.customers.find((x) => x.id === id)?.name ?? id;
  switch (c.kind) {
    case "new_customers": {
      const count = p.count ?? 1;
      const each = p.avgMonthlyBilling ?? 0;
      const amount = count * each;
      // The first bill is paid after the usual payment terms.
      const from = addDays(start, f.terms);
      const title = `${count} new customer${count === 1 ? "" : "s"} at ${money(each)} a month`;
      return {
        title,
        effect: `${title}, first payments from ${from}`,
        changes:
          amount > 0 && Number.isSafeInteger(amount)
            ? [
                {
                  kind: "recurring_cash",
                  label: label(title),
                  direction: "in",
                  amount,
                  fromDate: from,
                  everyDays: 30,
                },
              ]
            : [],
      };
    }
    case "billing_growth": {
      const pct = p.percent ?? 0;
      const title = `Existing customers' billing up ${pct}%`;
      return {
        title,
        effect: `${title} from ${start}`,
        changes: [
          {
            kind: "scale_recurring",
            label: label(title),
            flows: "billing",
            names: [],
            percent: pct,
            fromDate: start,
          },
        ],
      };
    }
    case "churn_increase": {
      const pct = p.percent ?? 0;
      const lost = atRiskCustomers(snapshot, model, f.schedule, start, f.end, pct);
      const title = `About ${pct}% of recurring revenue cancels`;
      return {
        title,
        effect: lost.length
          ? `${title}: ${lost.map((l) => name(l.customerId)).join(", ")} at their next renewal`
          : `${title}, but no customer is small enough to fit that share`,
        changes: lost.map((l) => ({
          kind: "churn" as const,
          customerId: l.customerId,
          fromDate: l.from,
        })),
      };
    }
    case "funding_round": {
      const amount = p.amount ?? 0;
      const title = `Funding round of ${money(amount)}`;
      return {
        title,
        effect: `${title} lands ${start}`,
        changes: [{ kind: "add_cash", date: start, amount, label: label(title) }],
      };
    }
    case "one_time_cost": {
      const amount = p.amount ?? 0;
      const title = `One-time cost of ${money(amount)}`;
      return {
        title,
        effect: `${title} paid ${start}`,
        changes: [{ kind: "remove_cash", date: start, amount, label: label(title) }],
      };
    }
    case "hiring_wave": {
      const heads = p.headcount ?? 1;
      const perHead = p.costPerHead ?? 0;
      const monthly = Math.round((heads * perHead) / 12);
      const title = `${heads} new hire${heads === 1 ? "" : "s"} at ${money(perHead)} a year`;
      return {
        title,
        effect: `${title}, about ${money(monthly)} more payroll a month from ${start}`,
        changes:
          monthly > 0
            ? [
                {
                  kind: "recurring_cash",
                  label: label(title),
                  direction: "out",
                  amount: monthly,
                  fromDate: start,
                  everyDays: 30,
                },
              ]
            : [],
      };
    }
    case "slower_collections": {
      const days = p.days ?? 0;
      const payers = topCustomers(receipts, MAX_PAYERS);
      const title = `The ${payers.length} largest payers pay ${days} days slower`;
      return {
        title,
        effect: `${title} from ${start}`,
        changes: payers.map((customerId) => ({
          kind: "delay_customer" as const,
          customerId,
          days,
          fromDate: start,
          basis: `${tag || "Predicted: "}${title.toLowerCase()}`.slice(0, 200),
        })),
      };
    }
    case "pipeline_acceleration":
    case "pipeline_slowdown": {
      const sooner = c.kind === "pipeline_acceleration";
      const days = p.days ?? 0;
      const deals = receipts.filter((i) => i.kind === "deal");
      const changes: Change[] = [];
      for (const customerId of topCustomers(deals, MAX_DEALS)) {
        const firstPay =
          receipts
            .filter((i) => i.customerId === customerId)
            .map((i) => i.date)
            .sort()[0] ?? start;
        // Payments never move before the event starts.
        const shift = sooner ? -Math.min(days, daysBetween(start, firstPay)) : days;
        if (shift === 0) continue;
        changes.push({
          kind: "delay_customer",
          customerId,
          days: shift,
          fromDate: start,
          basis:
            `${tag || "Predicted: "}${name(customerId)}'s new-deal payments arrive ${Math.abs(shift)} days ${sooner ? "sooner" : "later"}`.slice(
              0,
              200,
            ),
        });
      }
      const title = `New deals close ${days} days ${sooner ? "faster" : "slower"}`;
      return {
        title,
        effect: changes.length
          ? `${title} (${changes.length} signed deals)`
          : `${title}, but no signed new deals are expected in these weeks`,
        changes,
      };
    }
  }
}
