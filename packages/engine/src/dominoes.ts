import type {
  Cents,
  Constraint,
  Domino,
  DominoContext,
  Evidence,
  Forecast,
  ISODate,
  Snapshot,
} from "@domino/contracts";
import { addDays, horizonEnd } from "./dates";
import { type CashSchedule, cashSchedule } from "./forecast";
import { compareIds } from "./funding";
import { type RuleBreach, evaluateOnSchedule, verifiedSchedule, weeklyBreach } from "./rules";
import { type CashItem, bucketOf } from "./schedule";

/** One domino before ordering. `cause` picks a supporting domino among those sorted before it. */
type Draft = {
  key: string;
  week: number;
  date: ISODate;
  /** Same-day tie-break: event, then cash drop, then breach, then consequence */
  rank: 0 | 1 | 2 | 3;
  weekStart: ISODate;
  label: string;
  constraintId?: string;
  evidence: Evidence[];
  cause?: (earlier: Draft[]) => Draft | undefined;
};

/** A snapshot record whose scheduled cash differs between the base and the scenario. */
type RecordChange = {
  kind: "invoice" | "deal" | "bill";
  id: string;
  before?: CashItem;
  after?: CashItem;
  /** Weeks that get less cash than in the base schedule */
  lessCashWeeks: Set<number>;
  draft: Draft;
};

/**
 * Build-spec §6.2 with C1 context. Emits the first breach of each constraint, plus event and
 * cash-drop markers only for real effective changes with schedule evidence. causedBy is set
 * only when supported: drops and weekly breaches need the context's baseline counterfactual;
 * a consequence follows its own breach because the constraint's metadata says so.
 */
export function dominoes(
  forecast: Forecast,
  constraints: Constraint[],
  snapshot: Snapshot,
  context?: DominoContext,
): Domino[] {
  const schedule = context ? verifiedSchedule(snapshot, forecast, context) : null;
  const results = evaluateOnSchedule(snapshot, forecast, constraints, schedule);
  const changed =
    context && schedule
      ? recordChanges(snapshot, cashSchedule(snapshot, context.model, []), schedule)
      : [];
  const drafts = [
    ...changed.map((c) => c.draft),
    ...dropDrafts(snapshot, forecast, changed, context?.baseline),
    ...results.flatMap((r) =>
      r.breach ? breachDrafts(r.constraint, r.breach, snapshot, context?.baseline) : [],
    ),
  ];
  return finalize(drafts);
}

function finalize(drafts: Draft[]): Domino[] {
  const sorted = [...drafts].sort(
    (a, b) =>
      a.week - b.week ||
      (a.date === b.date ? 0 : a.date < b.date ? -1 : 1) ||
      a.rank - b.rank ||
      compareIds(a.key, b.key),
  );
  return sorted.map((d, i) => {
    const cause = d.cause?.(sorted.slice(0, i));
    const causedBy = cause ? sorted.indexOf(cause) + 1 : 0;
    return {
      order: i + 1,
      weekStart: d.weekStart,
      label: d.label,
      ...(d.constraintId ? { constraintId: d.constraintId } : {}),
      ...(causedBy > 0 ? { causedBy } : {}),
      evidence: d.evidence,
    };
  });
}

// ---------- Event markers ----------

type RecordItem = CashItem & { kind: RecordChange["kind"] };
const SOURCE = { invoice: "stripe", deal: "crm", bill: "books" } as const;
const isRecord = (i: CashItem): i is RecordItem => i.kind in SOURCE;

/**
 * Compares the net result of all changes with the no-change schedule, so a change that a later
 * change undoes (a delay then its reversal) leaves no marker and no causal claim.
 */
function recordChanges(
  snapshot: Snapshot,
  base: CashSchedule,
  scenario: CashSchedule,
): RecordChange[] {
  const first = addDays(snapshot.asOf, 1);
  const end = horizonEnd(scenario.weeks);
  const before = recordItems(base.items);
  const after = recordItems(scenario.items);
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort(compareIds);
  return keys.flatMap((key) => {
    const b = before.get(key);
    const a = after.get(key);
    const item = a ?? b;
    if (!item) return [];
    const days = [b, a].flatMap((i) => (i ? [clampDay(i.date, first)] : []));
    const inHorizon = days.filter((d) => d <= end).sort();
    const same = b && a && b.amount === a.amount && days[0] === days[1];
    const date = inHorizon[0];
    if (same || !date) return [];
    const kind = item.kind;
    const lessCashWeeks = lessCash(b, a, first, scenario.weeks);
    const draft = eventDraft(kind, item.id, b, a, date, snapshot, scenario.weeks);
    return [
      {
        kind,
        id: item.id,
        ...(b ? { before: b } : {}),
        ...(a ? { after: a } : {}),
        lessCashWeeks,
        draft,
      },
    ];
  });
}

const recordItems = (items: CashItem[]) =>
  new Map(items.filter(isRecord).map((i) => [`${i.kind}:${i.id}`, i]));

const clampDay = (date: ISODate, first: ISODate) => (date < first ? first : date);

function lessCash(
  b: CashItem | undefined,
  a: CashItem | undefined,
  first: ISODate,
  weeks: ISODate[],
) {
  const delta = new Map<number, Cents>();
  const add = (item: CashItem | undefined, sign: number) => {
    const w = item ? bucketOf(clampDay(item.date, first), weeks) : null;
    if (item && w !== null) delta.set(w, (delta.get(w) ?? 0) + sign * item.amount);
  };
  add(b, -1);
  add(a, 1);
  return new Set([...delta].filter(([, d]) => d < 0).map(([w]) => w));
}

function eventDraft(
  kind: RecordChange["kind"],
  id: string,
  b: CashItem | undefined,
  a: CashItem | undefined,
  date: ISODate,
  snapshot: Snapshot,
  weeks: ISODate[],
): Draft {
  const week = bucketOf(date, weeks) ?? 0;
  const was = b ? `${b.date} for ${money(Math.abs(b.amount))}` : "nothing";
  const now = a ? `${a.date} for ${money(Math.abs(a.amount))}` : "nothing";
  return {
    key: `event:${kind}:${id}`,
    week,
    date,
    rank: 0,
    weekStart: weeks[week] ?? date,
    label: eventLabel(kind, id, b, a, snapshot, horizonEnd(weeks)),
    evidence: [
      { source: SOURCE[kind], ref: id, note: `Scheduled ${was} before changes; ${now} now` },
    ],
  };
}

function eventLabel(
  kind: RecordChange["kind"],
  id: string,
  b: CashItem | undefined,
  a: CashItem | undefined,
  snapshot: Snapshot,
  end: ISODate,
): string {
  const amount = money(Math.abs((b ?? a)?.amount ?? 0));
  const subject =
    kind === "bill"
      ? `${amount} payment to ${snapshot.bills.find((x) => x.id === id)?.vendor ?? id}`
      : `${amount} ${kind === "deal" ? "deal payment" : "payment"} from ${customerName(snapshot, a ?? b)}`;
  if (!a) return `${subject}, expected ${b?.date}, drops out of this scenario`;
  if (!b) return `${subject} is added on ${a.date}`;
  if (a.amount !== b.amount)
    return `${subject} changes to ${money(Math.abs(a.amount))} on ${a.date}`;
  const late = a.date > end ? ", after the forecast window" : "";
  return `${subject} moves from ${b.date} to ${a.date}${late}`;
}

const customerName = (snapshot: Snapshot, item: CashItem | undefined) =>
  snapshot.customers.find((c) => c.id === item?.customerId)?.name ??
  item?.customerId ??
  "a customer";

// ---------- Cash-drop markers ----------

/** Strictly more than a 5% fall from a positive prior usable balance, in exact integers. */
function bigDrop(prior: Cents, current: Cents): boolean {
  return prior > 0 && 20n * (BigInt(prior) - BigInt(current)) > BigInt(prior);
}

function dropDrafts(
  snapshot: Snapshot,
  forecast: Forecast,
  changed: RecordChange[],
  baseline?: Forecast,
): Draft[] {
  const start = snapshot.cashOnHand - snapshot.restrictedCash;
  const prior = (f: Forecast, i: number) => (i === 0 ? start : (f.weeks[i - 1]?.usable ?? start));
  return forecast.weeks.flatMap((w, i) => {
    const causes = changed.filter((c) => c.lessCashWeeks.has(i));
    if (!causes.length || !bigDrop(prior(forecast, i), w.usable)) return [];
    const base = baseline?.weeks[i];
    const counterfactual = baseline && base ? !bigDrop(prior(baseline, i), base.usable) : false;
    const only = causes.length === 1 ? causes[0] : undefined;
    const draft: Draft = {
      key: `drop:${String(i).padStart(2, "0")}`,
      week: i,
      date: addDays(w.weekStart, 6),
      rank: 1,
      weekStart: w.weekStart,
      label: `Usable cash drops from ${money(prior(forecast, i))} to ${money(w.usable)}`,
      evidence: causes.map((c) => ({
        source: SOURCE[c.kind],
        ref: c.id,
        note: "Less cash this week than in the schedule before changes",
      })),
    };
    if (counterfactual && only) draft.cause = (earlier) => earlier.find((d) => d === only.draft);
    return [draft];
  });
}

// ---------- Rule breaches and consequences ----------

function breachDrafts(
  constraint: Constraint,
  breach: RuleBreach,
  snapshot: Snapshot,
  baseline?: Forecast,
): Draft[] {
  const draft: Draft = {
    key: `breach:${constraint.id}`,
    week: breach.week,
    date: breach.date,
    rank: 2,
    weekStart: breach.weekStart,
    label: breachLabel(constraint, breach),
    constraintId: constraint.id,
    evidence: breach.evidence,
  };
  if (causedByScenario(constraint, breach, snapshot, baseline)) draft.cause = latestCause;
  if (!constraint.consequence) return [draft];
  const { constraintId: _, ...rest } = draft;
  const consequence: Draft = {
    ...rest,
    key: `consequence:${constraint.id}`,
    rank: 3,
    label: constraint.consequence.label,
    evidence: [constraint.consequence.evidence],
    cause: (earlier) => earlier.find((d) => d === draft),
  };
  return [draft, consequence];
}

/**
 * Supported only for weekly rules with a baseline that does not break the same rule by the
 * same week. A weekly baseline cannot replay daily bill funding, so pay_by_date gets no link.
 */
function causedByScenario(
  constraint: Constraint,
  breach: RuleBreach,
  snapshot: Snapshot,
  baseline?: Forecast,
): boolean {
  if (!baseline || constraint.kind === "pay_by_date") return false;
  const without = weeklyBreach(constraint, snapshot, baseline);
  return !without || without.week > breach.week;
}

/** The latest earlier cash drop, else the only earlier event; otherwise no claim. */
function latestCause(earlier: Draft[]): Draft | undefined {
  const drops = earlier.filter((d) => d.rank === 1);
  if (drops.length) return drops[drops.length - 1];
  const events = earlier.filter((d) => d.rank === 0);
  return events.length === 1 ? events[0] : undefined;
}

function breachLabel(constraint: Constraint, breach: RuleBreach): string {
  if (breach.kind === "pay_by_date") {
    return `Projected funding shortfall: ${money(breach.bill.amount)} bill from ${breach.bill.vendor} is not funded by its ${breach.deadline} deadline`;
  }
  if (breach.kind === "min_runway_months") {
    return `Runway falls under ${constraint.limit} months (${constraint.label})`;
  }
  const limit = Number.isInteger(constraint.limit) ? ` of ${money(constraint.limit)}` : "";
  return `Usable cash falls to ${money(breach.usable)}, below ${constraint.label}${limit}`;
}

/** Display text only: whole cents to "$1,234.56", dropping ".00". */
export function money(cents: Cents): string {
  const abs = Math.abs(cents);
  const rest = abs % 100;
  const dollars = String((abs - rest) / 100).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${cents < 0 ? "-" : ""}$${dollars}${rest ? `.${String(rest).padStart(2, "0")}` : ""}`;
}
