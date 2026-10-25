import {
  type Cents,
  type Change,
  type CompanyModel,
  type Constraint,
  type ISODate,
  type ScheduledItem,
  type Snapshot,
  firstForecastWeek,
} from "@domino/contracts";
import {
  CFS_LINES,
  type CfsLineId,
  type CfsSection,
  type CfsWeek,
  cashFlowStatement,
  cashFlowSummary,
  projectedCashFlow,
  scheduledItems,
} from "@domino/engine";

/**
 * Pure dashboard numbers from one snapshot, through the real engine. Shared by the Convex query
 * (convex/fieldDashboard.ts) and the demo path, so live and demo screens use the same math.
 * Integer cents only; the UI formats. Plain JSON out (null, never undefined) so Convex can
 * return it. Relative imports only: the Convex bundle has no "@/" alias.
 */

export const DASHBOARD_METHOD = "field-dashboard-1.0.0";
/** Complete actual weeks shown before the forecast (plus the partial current week). */
export const ACTUAL_WEEKS = 4;
/** Scheduled items at least this share of cash today get a marker on the cash line. */
const MARKER_SHARE = 0.05;
const DAY_MS = 86_400_000;

export type Health = "ok" | "watch" | "at_risk";
/**
 * at_risk: `week` is the first week below the minimum, `line` the biggest outflow that week,
 * `cents` the gap to cover. watch / ok: `week` is the low point, `cents` the room left there.
 */
export type HealthView = {
  rating: Health;
  week: ISODate | null;
  line: { label: string; cents: Cents } | null;
  cents: Cents;
};

export type DashboardBar = {
  weekStart: ISODate;
  kind: "actual" | "projected";
  partial: boolean;
  operating: Cents;
  investing: Cents;
  financing: Cents;
  netChange: Cents;
  endingCash: Cents;
};

export type CashPoint = { weekStart: ISODate; label: "today" | "week"; usable: Cents };
export type Marker = { weekStart: ISODate; cents: Cents; label: string };
export type LineTotal = { id: CfsLineId; label: string; section: CfsSection; cents: Cents };
export type AgeBucket = { label: string; count: number; cents: Cents };
export type BillDue = {
  id: string;
  vendor: string;
  cents: Cents;
  payOn: ISODate;
  overdue: boolean;
  critical: boolean;
};
export type Upcoming = {
  id: string;
  kind: ScheduledItem["kind"];
  counterparty: string;
  cents: Cents;
  dueWeek: ISODate;
  status: ScheduledItem["status"];
};

export type SampleRisk = {
  id: string;
  title: string;
  /** First week usable cash is below the lender's minimum; null = survives all 13 weeks. */
  failsWeek: ISODate | null;
  /** Change in the 13-week low point versus the base forecast (negative = worse). */
  impact: Cents;
  fix: { label: string; cents: Cents; survives: boolean } | null;
};

export type DashboardView = {
  method: typeof DASHBOARD_METHOD;
  asOf: ISODate;
  forecastStart: ISODate;
  cashToday: Cents;
  restrictedCash: Cents;
  usableToday: Cents;
  lenderMinimum: { label: string; cents: Cents } | null;
  lowest: { weekStart: ISODate; usable: Cents } | null;
  roomToday: Cents | null;
  roomAtLow: Cents | null;
  /** First projected week usable cash ends below the lender's minimum (or below zero). */
  firstBreach: ISODate | null;
  runway: { weeks: number | null; weeklyBurn: Cents; basisWeeks: number };
  netChange13: Cents;
  totals: { operating: Cents; investing: Cents; financing: Cents };
  bars: DashboardBar[];
  biggestLines: LineTotal[];
  cashLine: CashPoint[];
  markers: Marker[];
  next2Weeks: { weeks: ISODate[]; inflows: Cents; outflows: Cents; items: Upcoming[] };
  overdue: { buckets: AgeBucket[]; count: number; cents: Cents };
  billsDueSoon: BillDue[];
  unclassified: number;
  health: HealthView;
  risks: SampleRisk[];
};

export type DashboardResult = { ok: true; view: DashboardView } | { ok: false; message: string };

export type DashboardInput = {
  snapshot: Snapshot;
  model: CompanyModel;
  constraints: Constraint[];
};

const days = (from: ISODate, to: ISODate) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
const plusDays = (date: ISODate, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** Lowest projected usable cash and the first week below `floor`. */
function lowAndBreach(weeks: CfsWeek[], restricted: Cents, floor: Cents) {
  let low: { weekStart: ISODate; usable: Cents } | null = null;
  let breach: ISODate | null = null;
  for (const w of weeks) {
    const usable = w.endingCash - restricted;
    if (low === null || usable < low.usable) low = { weekStart: w.weekStart, usable };
    if (breach === null && usable < floor) breach = w.weekStart;
  }
  return { low, breach };
}

export function deriveDashboard({ snapshot, model, constraints }: DashboardInput): DashboardResult {
  const statement = cashFlowStatement(snapshot, model, [], { weeks: ACTUAL_WEEKS + 1 });
  if (!statement.ok) return { ok: false, message: statement.error.message };
  const st = statement.value;
  const summary = cashFlowSummary(st, ACTUAL_WEEKS);
  const projected = st.weeks.filter((w) => w.kind === "projected");
  const restricted = snapshot.restrictedCash;
  const usableToday = snapshot.cashOnHand - restricted;
  const minCash = constraints.find((c) => c.kind === "min_cash");
  const lenderMinimum = minCash ? { label: minCash.label, cents: Math.round(minCash.limit) } : null;
  const floor = lenderMinimum?.cents ?? 0;
  const { low: lowest, breach: firstBreach } = lowAndBreach(projected, restricted, floor);

  const bars: DashboardBar[] = st.weeks.map((w) => ({
    weekStart: w.weekStart,
    kind: w.kind,
    partial: w.kind === "actual" && days(w.weekStart, w.weekEnd) < 6,
    operating: w.operating,
    investing: w.investing,
    financing: w.financing,
    netChange: w.netChange,
    endingCash: w.endingCash,
  }));

  const lineSums = new Map<CfsLineId, Cents>();
  for (const w of projected)
    for (const l of CFS_LINES) lineSums.set(l.id, (lineSums.get(l.id) ?? 0) + w.lines[l.id]);
  const biggestLines: LineTotal[] = CFS_LINES.map((l) => ({
    id: l.id,
    label: l.label,
    section: l.section,
    cents: lineSums.get(l.id) ?? 0,
  }))
    .filter((l) => l.cents !== 0)
    .sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents))
    .slice(0, 5);

  const forecastStart = firstForecastWeek(snapshot.asOf);
  const cashLine: CashPoint[] = [
    { weekStart: snapshot.asOf, label: "today", usable: usableToday },
    ...projected.map((w) => ({
      weekStart: w.weekStart,
      label: "week" as const,
      usable: w.endingCash - restricted,
    })),
  ];

  const items = scheduledItems(snapshot);
  const markerFloor = Math.abs(snapshot.cashOnHand) * MARKER_SHARE;
  const byWeek = new Map<string, Marker>();
  for (const i of items) {
    if (Math.abs(i.cents) < markerFloor) continue;
    const key = `${i.dueWeek}|${i.counterparty}`;
    const m = byWeek.get(key);
    if (m) m.cents += i.cents;
    else byWeek.set(key, { weekStart: i.dueWeek, cents: i.cents, label: i.counterparty });
  }
  const markers = [...byWeek.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  const twoWeeks = [forecastStart, plusDays(forecastStart, 7)];
  const soon = items.filter((i) => twoWeeks.includes(i.dueWeek));
  const next2Weeks = {
    weeks: twoWeeks,
    inflows: soon.reduce((s, i) => (i.cents > 0 ? s + i.cents : s), 0),
    outflows: soon.reduce((s, i) => (i.cents < 0 ? s + i.cents : s), 0),
    items: [...soon]
      .sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents) || a.id.localeCompare(b.id))
      .slice(0, 6)
      .map((i) => ({
        id: i.id,
        kind: i.kind,
        counterparty: i.counterparty,
        cents: i.cents,
        dueWeek: i.dueWeek,
        status: i.status,
      })),
  };

  const buckets: AgeBucket[] = [
    { label: "1-30 days", count: 0, cents: 0 },
    { label: "31-60 days", count: 0, cents: 0 },
    { label: "61-90 days", count: 0, cents: 0 },
    { label: "Over 90 days", count: 0, cents: 0 },
  ];
  for (const inv of snapshot.invoices) {
    if (inv.paid !== undefined || inv.writtenOff !== undefined || inv.amount <= 0) continue;
    const late = days(inv.due, snapshot.asOf);
    if (late < 1) continue;
    const b = buckets[late <= 30 ? 0 : late <= 60 ? 1 : late <= 90 ? 2 : 3]!;
    b.count += 1;
    b.cents += inv.amount;
  }
  const overdue = {
    buckets,
    count: buckets.reduce((s, b) => s + b.count, 0),
    cents: buckets.reduce((s, b) => s + b.cents, 0),
  };

  const horizon = plusDays(snapshot.asOf, 14);
  const billsDueSoon: BillDue[] = snapshot.bills
    .filter((b) => b.paid === undefined && b.amount > 0 && (b.agreedPayOn ?? b.due) <= horizon)
    .map((b) => ({
      id: b.id,
      vendor: b.vendor,
      cents: b.amount,
      payOn: b.agreedPayOn ?? b.due,
      overdue: b.due < snapshot.asOf,
      critical: b.critical,
    }))
    .sort((a, b) => a.payOn.localeCompare(b.payOn) || b.cents - a.cents)
    .slice(0, 6);

  const view: DashboardView = {
    method: DASHBOARD_METHOD,
    asOf: snapshot.asOf,
    forecastStart,
    cashToday: snapshot.cashOnHand,
    restrictedCash: restricted,
    usableToday,
    lenderMinimum,
    lowest,
    roomToday: lenderMinimum ? usableToday - lenderMinimum.cents : null,
    roomAtLow: lenderMinimum && lowest ? lowest.usable - lenderMinimum.cents : null,
    firstBreach,
    runway: {
      weeks: summary.runway.weeks,
      weeklyBurn: summary.runway.weeklyBurn,
      basisWeeks: summary.runway.basis.length,
    },
    netChange13: summary.projectedTotals.netChange,
    totals: {
      operating: summary.projectedTotals.operating,
      investing: summary.projectedTotals.investing,
      financing: summary.projectedTotals.financing,
    },
    bars,
    biggestLines,
    cashLine,
    markers,
    next2Weeks,
    overdue,
    billsDueSoon,
    unclassified: st.unclassified.length,
    health: { rating: "ok", week: null, line: null, cents: 0 },
    risks: [],
  };
  view.health = standInHealth(view, projected);
  view.risks = sampleRisks({ snapshot, model, constraints }, view, items);
  return { ok: true, view };
}

/**
 * Stand-in health rating until the Timeline lane's rating is connected: compares the 13-week
 * low point with the lender's minimum. Labelled as sample data in the UI, which writes the words.
 */
function standInHealth(view: DashboardView, projected: CfsWeek[]): HealthView {
  const floor = view.lenderMinimum?.cents ?? 0;
  if (view.firstBreach && view.lowest) {
    const week = projected.find((w) => w.weekStart === view.firstBreach);
    const worst = week
      ? CFS_LINES.map((l) => ({ label: l.label, cents: week.lines[l.id] }))
          .filter((l) => l.cents < 0)
          .sort((a, b) => a.cents - b.cents)[0]
      : undefined;
    return {
      rating: "at_risk",
      week: view.firstBreach,
      line: worst ? { label: worst.label, cents: -worst.cents } : null,
      cents: floor - view.lowest.usable,
    };
  }
  const room = view.roomAtLow ?? view.lowest?.usable ?? 0;
  const tight = room < Math.max(floor * 0.1, -view.netChange13 / 13);
  return {
    rating: tight ? "watch" : "ok",
    week: view.lowest?.weekStart ?? null,
    line: null,
    cents: room,
  };
}

/**
 * Sample scenarios until the Timeline lane's auto-analysis is connected. The scenario choice is
 * a stand-in; the outcome of each is the real engine forecast with that change applied.
 */
function sampleRisks(
  input: DashboardInput,
  view: DashboardView,
  items: ScheduledItem[],
): SampleRisk[] {
  const { snapshot, model } = input;
  const floor = view.lenderMinimum?.cents ?? 0;
  const base = view.lowest?.usable ?? view.usableToday;
  const receivables = items.filter((i) => i.kind === "receivable");
  const biggest = [...receivables].sort((a, b) => b.cents - a.cents)[0];
  const byCustomer = new Map<string, Cents>();
  for (const inv of snapshot.invoices)
    if (inv.paid === undefined && inv.writtenOff === undefined && inv.amount > 0)
      byCustomer.set(inv.customerId, (byCustomer.get(inv.customerId) ?? 0) + inv.amount);
  const topCustomer = [...byCustomer.entries()].sort((a, b) => b[1] - a[1])[0];
  const customerName = (id: string) => snapshot.customers.find((c) => c.id === id)?.name ?? id;
  const shock = Math.max(
    25_000_000,
    Math.round(Math.abs(view.netChange13) / 13 / 1_000_000) * 1_000_000,
  );

  const scenarios: { id: string; title: string; change: Change }[] = [];
  if (biggest)
    scenarios.push({
      id: "late_biggest_invoice",
      title: `${biggest.counterparty} pays its largest open invoice 30 days late`,
      change: { kind: "delay_invoice", invoiceId: biggest.sourceRef, days: 30 },
    });
  if (topCustomer)
    scenarios.push({
      id: "lose_top_customer",
      title: `${customerName(topCustomer[0])} stops paying`,
      change: { kind: "churn", customerId: topCustomer[0], fromDate: snapshot.asOf },
    });
  scenarios.push({
    id: "surprise_expense",
    title: "An unplanned expense lands next week",
    change: {
      kind: "remove_cash",
      date: plusDays(view.forecastStart, 2),
      amount: shock,
      label: "Unplanned expense",
    },
  });

  const run = (changes: Change[]) => {
    const r = projectedCashFlow(snapshot, model, changes);
    return r.ok ? lowAndBreach(r.value.weeks, snapshot.restrictedCash, floor) : null;
  };
  const out: SampleRisk[] = [];
  for (const s of scenarios) {
    const result = run([s.change]);
    if (!result?.low) continue;
    const gap = floor - result.low.usable;
    let fix: SampleRisk["fix"] = null;
    if (gap > 0) {
      // Round the draw up to the next $50K so the label is a sensible ask.
      const draw = Math.ceil(gap / 5_000_000) * 5_000_000;
      const fixed = run([
        s.change,
        { kind: "add_cash", date: view.forecastStart, amount: draw, label: "Credit line draw" },
      ]);
      fix = { label: "Draw on the credit line", cents: draw, survives: fixed?.breach === null };
    }
    out.push({
      id: s.id,
      title: s.title,
      failsWeek: result.breach,
      impact: result.low.usable - base,
      fix,
    });
  }
  return out.sort((a, b) => a.impact - b.impact).slice(0, 3);
}
