import type {
  HistoricalCase,
  HistoricalComparison,
  HistoricalFact,
  HistoricalMetric,
  HistoricalRun,
  ISODate,
} from "@domino/contracts";
import { formatCents } from "../dashboard/money";

// Quarterly rewind for 2U: pure, deterministic derivations for the dashboard. Two strictly
// separate views:
// - deriveRewind reads only facts available at the run's knowledge cutoff (it re-filters, so a
//   later case view passed by mistake still cannot leak) plus the run's frozen predictions.
// - deriveReveal reads the reveal record and the evidence view frozen with it.
// Facts are picked by metric and period, never by a guessed id. No lender's minimum is
// invented: a limit line exists only if the run carries a disclosed-term risk rule.

const DAY = 86_400_000;
const at = (ts: string) => Date.parse(ts);
/** The calendar date as written in an offset timestamp. */
export const localDate = (ts: string): ISODate => ts.slice(0, 10);
const dayNumber = (d: ISODate) => Math.round(Date.parse(`${d}T00:00:00Z`) / DAY);
const fromDayNumber = (n: number): ISODate => new Date(n * DAY).toISOString().slice(0, 10);
const months = (start: ISODate, end: ISODate) =>
  (Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 +
  (Number(end.slice(5, 7)) - Number(start.slice(5, 7))) +
  1;

/** Domino's rule parameters, stated on screen next to each flag. */
export const RULES = {
  /** Flag a fall in cash including restricted cash larger than this over the reported period. */
  declineShare: 0.25,
  /** Flag when usable cash covers fewer quarters than this at the recent pace. */
  runwayQuarters: 4,
} as const;

export interface FactRef {
  factId: string;
  label: string;
  cents: number;
  /** Balance date, or the period end of a flow. */
  periodText: string;
  /** Local date it became public (availableAt). */
  publishedOn: ISODate;
  source?: { id: string; title: string; url?: string };
  /** For derived facts: how it was computed. */
  derivation?: string;
}

export type FlagStatus = "flagged" | "clear" | "not_checked";

export interface RewindFlag {
  id: string;
  status: FlagStatus;
  title: string;
  detail: string;
  /** The rule in plain words, so the flag can be checked by hand. */
  rule: string;
  evidence: FactRef[];
}

export type PointKind = "reported" | "derived" | "modeled" | "forecast";

export interface QuarterPoint {
  date: ISODate;
  cents: number;
  kind: PointKind;
  /** Fact or prediction id behind the point. */
  ref: string;
}

export interface Limit {
  cents: number;
  ruleId: string;
  metric: HistoricalMetric;
}

export interface RewindView {
  companyName: string;
  caseId: string;
  runId: string;
  cutoff: ISODate;
  lastBalanceDate: ISODate;
  usable: FactRef;
  restricted: FactRef | null;
  total: FactRef;
  /** Frozen predictions from the saved run. */
  nowcast: { usable: QuarterPoint | null; total: QuarterPoint | null };
  forecast: { usable: QuarterPoint; total: QuarterPoint | null };
  /** Forecast change in usable cash from the last balance to the forecast date. */
  forecastChange: { cents: number; share: number };
  /** Average per quarter over the reported year-to-date period. */
  perQuarter: { operating: number; investing: number; beforeFinancing: number; quarters: number };
  /** Usable cash divided by the per-quarter burn; null when cash was not falling. */
  runway: { quarters: number; zeroOn: ISODate } | null;
  /** Cash including restricted cash at the start of the reported period, derived. */
  trendStart: QuarterPoint | null;
  flags: RewindFlag[];
  flaggedCount: number;
  rating: "warning" | "watch" | "clear";
  limit: Limit | null;
  chart: { total: QuarterPoint[]; usable: QuarterPoint[] };
  sources: { id: string; title: string; url?: string; publishedOn: ISODate }[];
}

const METRIC_TEXT: Record<string, string> = {
  cash_and_equivalents: "Cash and equivalents (restricted cash excluded)",
  restricted_cash: "Restricted cash",
  cash_including_restricted: "Cash including restricted cash",
  operating_cash_flow: "Operating cash flow",
  investing_cash_flow: "Investing cash flow",
  financing_cash_flow: "Financing cash flow",
  fx_effect_on_cash: "Exchange-rate effect on cash",
};

const shortDate = (d: ISODate) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

/** The dashboard's money format ($41.1M, true minus sign), so flags match the tiles. */
const millions = (cents: number) => formatCents(cents);

function periodText(f: HistoricalFact) {
  return f.period.kind === "instant"
    ? shortDate(f.period.date)
    : `${shortDate(f.period.start)} to ${shortDate(f.period.end)}`;
}

function ref(f: HistoricalFact, c: HistoricalCase): FactRef {
  const base = {
    factId: f.id,
    label: METRIC_TEXT[f.metric] ?? f.metric,
    cents: f.cents,
    periodText: periodText(f),
    publishedOn: localDate(f.availableAt),
  };
  if (f.kind === "derived") return { ...base, derivation: f.derivation };
  const s = c.sources.find((x) => x.id === f.sourceId);
  return {
    ...base,
    source: {
      id: f.sourceId,
      title: s?.title ?? f.sourceId,
      ...(s && /^https?:\/\//i.test(s.url) ? { url: s.url } : {}),
    },
  };
}

const instant = (facts: HistoricalFact[], metric: HistoricalMetric, date: ISODate) =>
  facts.find((f) => f.metric === metric && f.period.kind === "instant" && f.period.date === date);

/** The year-to-date flow ending on `end` with the longest span (the 10-Q's nine months). */
const flowEnding = (facts: HistoricalFact[], metric: HistoricalMetric, end: ISODate) =>
  facts
    .filter((f) => f.metric === metric && f.period.kind === "duration" && f.period.end === end)
    .sort((a, b) =>
      a.period.kind === "duration" && b.period.kind === "duration"
        ? a.period.start.localeCompare(b.period.start)
        : 0,
    )[0];

const prediction = (
  run: HistoricalRun,
  kind: "nowcast" | "forecast",
  metric: HistoricalMetric,
): QuarterPoint | null => {
  const p = run.predictions.find(
    (x) => x.kind === kind && x.metric === metric && x.period.kind === "instant",
  );
  if (!p || p.period.kind !== "instant") return null;
  return {
    date: p.period.date,
    cents: p.cents,
    kind: kind === "nowcast" ? "modeled" : "forecast",
    ref: p.id,
  };
};

export class RewindError extends Error {}

/** Cutoff-only case view: what anyone could read at the run's knowledge cutoff. */
export function atCutoff(c: HistoricalCase, cutoff: string): HistoricalCase {
  return {
    ...c,
    sources: c.sources.filter((s) => at(s.publishedAt) <= at(cutoff)),
    facts: c.facts.filter((f) => at(f.availableAt) <= at(cutoff)),
  };
}

/** The pre-reveal dashboard view. Reads only facts public at the run's cutoff. */
export function deriveRewind(caseView: HistoricalCase, run: HistoricalRun): RewindView {
  if (run.caseId !== caseView.id) throw new RewindError("The saved run belongs to another case");
  const known = atCutoff(caseView, run.knowledgeCutoff);
  const facts = known.facts;
  const origin = run.originBalanceDate;
  const usableFact = instant(facts, "cash_and_equivalents", origin);
  const totalFact = instant(facts, "cash_including_restricted", origin);
  if (!usableFact || !totalFact)
    throw new RewindError("The last reported balance is missing from the case");
  const restrictedFact = instant(facts, "restricted_cash", origin) ?? null;
  const op = flowEnding(facts, "operating_cash_flow", origin);
  const inv = flowEnding(facts, "investing_cash_flow", origin);
  const fin = flowEnding(facts, "financing_cash_flow", origin);
  const fx = flowEnding(facts, "fx_effect_on_cash", origin);
  if (!op || !inv || op.period.kind !== "duration")
    throw new RewindError("The year-to-date cash flows are missing from the case");

  const forecastUsable = prediction(run, "forecast", "cash_and_equivalents");
  if (!forecastUsable) throw new RewindError("The saved run has no usable-cash forecast");
  const forecastTotal = prediction(run, "forecast", "cash_including_restricted");
  const nowcastUsable = prediction(run, "nowcast", "cash_and_equivalents");
  const nowcastTotal = prediction(run, "nowcast", "cash_including_restricted");

  const quarters = months(op.period.start, op.period.end) / 3;
  const perQuarter = {
    operating: Math.round(op.cents / quarters),
    investing: Math.round(inv.cents / quarters),
    beforeFinancing: Math.round((op.cents + inv.cents) / quarters),
    quarters,
  };

  // Pace from the frozen forecast itself: change per day from the last balance to its target.
  const span = dayNumber(forecastUsable.date) - dayNumber(origin);
  const perDay = span > 0 ? (forecastUsable.cents - usableFact.cents) / span : 0;
  const runway =
    perQuarter.beforeFinancing < 0 && perDay < 0
      ? {
          quarters: Math.round((usableFact.cents / -perQuarter.beforeFinancing) * 10) / 10,
          zeroOn: fromDayNumber(dayNumber(origin) + Math.floor(usableFact.cents / -perDay)),
        }
      : null;

  // Start-of-period cash including restricted: end balance minus every flow in the period.
  const trendStart: QuarterPoint | null =
    fin && fx && op.period.kind === "duration"
      ? {
          date: fromDayNumber(dayNumber(op.period.start) - 1),
          cents: totalFact.cents - op.cents - inv.cents - fin.cents - fx.cents,
          kind: "derived",
          ref: `${totalFact.id}-${op.id}-${inv.id}-${fin.id}-${fx.id}`,
        }
      : null;

  const r = (f: HistoricalFact) => ref(f, known);
  const ytd = `${shortDate(op.period.start)} to ${shortDate(op.period.end)}`;
  const flags: RewindFlag[] = [];

  flags.push({
    id: "operating-outflow",
    status: op.cents < 0 ? "flagged" : "clear",
    title: op.cents < 0 ? "Operations used cash" : "Operations brought cash in",
    detail: `Operating cash flow was ${millions(op.cents)} from ${ytd}, about ${millions(perQuarter.operating)} a quarter.`,
    rule: "Flag when operating cash flow for the reported period is below zero.",
    evidence: [r(op)],
  });

  const before = op.cents + inv.cents;
  flags.push({
    id: "before-financing",
    status: before < 0 ? "flagged" : "clear",
    title: before < 0 ? "Cash burned before any financing" : "Cash positive before financing",
    detail: `Operating plus investing cash flow was ${millions(before)} from ${ytd}, about ${millions(perQuarter.beforeFinancing)} a quarter. A free cash flow proxy: investing includes more than equipment.`,
    rule: "Flag when operating plus investing cash flow is below zero.",
    evidence: [r(op), r(inv)],
  });

  if (trendStart) {
    const share = (trendStart.cents - totalFact.cents) / trendStart.cents;
    flags.push({
      id: "cash-decline",
      status: share > RULES.declineShare ? "flagged" : "clear",
      title:
        share > 0
          ? `Cash fell ${Math.round(share * 100)}% in ${months(op.period.start, op.period.end)} months`
          : "Cash did not fall over the period",
      detail: `Cash including restricted cash went from ${millions(trendStart.cents)} on ${shortDate(trendStart.date)} (derived) to ${millions(totalFact.cents)} on ${shortDate(origin)}.`,
      rule: `Flag when cash including restricted cash falls more than ${RULES.declineShare * 100}% over the reported period. The start balance is the end balance minus the period's operating, investing, financing and exchange-rate flows.`,
      evidence: [r(totalFact), r(op), r(inv), ...(fin ? [r(fin)] : []), ...(fx ? [r(fx)] : [])],
    });
  }

  if (fin) {
    flags.push({
      id: "financing-outflow",
      status: fin.cents < 0 ? "flagged" : "clear",
      title: fin.cents < 0 ? "Financing took cash out, not in" : "Financing brought cash in",
      detail: `Financing cash flow was ${millions(fin.cents)} from ${ytd}${
        fin.cents < 0 && -fin.cents > -before
          ? ", more than operations and investing used together"
          : ""
      }. The forecast assumes zero financing next quarter.`,
      rule: "Flag when financing cash flow for the reported period is below zero.",
      evidence: [r(fin)],
    });
  }

  flags.push({
    id: "runway",
    status: runway && runway.quarters < RULES.runwayQuarters ? "flagged" : "clear",
    title: runway
      ? `About ${runway.quarters} quarters of usable cash at this pace`
      : "No burn-based runway: cash was not falling",
    detail: runway
      ? `${millions(usableFact.cents)} of usable cash on ${shortDate(origin)} against ${millions(perQuarter.beforeFinancing)} a quarter before financing. At the forecast's daily pace it would reach zero around ${shortDate(runway.zeroOn)}, if nothing else changed. A simple pace, not a prediction of default.`
      : "Usable cash was not falling at the recent pace.",
    rule: `Flag when usable cash covers fewer than ${RULES.runwayQuarters} quarters of operating plus investing outflow.`,
    evidence: [r(usableFact), r(op), r(inv)],
  });

  const disclosed = run.riskRules.find(
    (x) => x.basis === "disclosed_term" && x.breachWhen === "below",
  );
  flags.push({
    id: "debt-terms",
    status: "not_checked",
    title: disclosed ? "Lender's minimum on file" : "Debt and lender terms not checked",
    detail: disclosed
      ? `The saved run carries a disclosed minimum of ${millions(disclosed.thresholdCents)}.`
      : "The audited case holds cash facts only. Debt maturities, interest and any lender's minimum are not in it, so Domino draws no limit line and makes no claim about them.",
    rule: "Checked only when a disclosed lender term is part of the saved run.",
    evidence: [],
  });

  const flaggedCount = flags.filter((f) => f.status === "flagged").length;
  const chartTotal = [
    ...(trendStart ? [trendStart] : []),
    { date: origin, cents: totalFact.cents, kind: "reported" as const, ref: totalFact.id },
    ...(nowcastTotal ? [nowcastTotal] : []),
    ...(forecastTotal ? [forecastTotal] : []),
  ];
  const chartUsable = [
    { date: origin, cents: usableFact.cents, kind: "reported" as const, ref: usableFact.id },
    ...(nowcastUsable ? [nowcastUsable] : []),
    forecastUsable,
  ];

  return {
    companyName: known.companyName,
    caseId: known.id,
    runId: run.id,
    cutoff: localDate(run.knowledgeCutoff),
    lastBalanceDate: origin,
    usable: r(usableFact),
    restricted: restrictedFact ? r(restrictedFact) : null,
    total: r(totalFact),
    nowcast: { usable: nowcastUsable, total: nowcastTotal },
    forecast: { usable: forecastUsable, total: forecastTotal },
    forecastChange: {
      cents: forecastUsable.cents - usableFact.cents,
      share: (forecastUsable.cents - usableFact.cents) / usableFact.cents,
    },
    perQuarter,
    runway,
    trendStart,
    flags,
    flaggedCount,
    rating: flaggedCount >= 3 ? "warning" : flaggedCount > 0 ? "watch" : "clear",
    limit: disclosed
      ? { cents: disclosed.thresholdCents, ruleId: disclosed.id, metric: disclosed.metric }
      : null,
    chart: { total: chartTotal, usable: chartUsable },
    sources: known.sources.map((s) => ({
      id: s.id,
      title: s.title,
      ...(/^https?:\/\//i.test(s.url) ? { url: s.url } : {}),
      publishedOn: localDate(s.publishedAt),
    })),
  };
}

export interface RevealRow {
  predictionId: string;
  metric: HistoricalMetric;
  label: string;
  date: ISODate;
  forecast: number;
  actual: number;
  difference: number;
  fact: FactRef;
}

export interface RevealView {
  revealedThrough: ISODate;
  rows: RevealRow[];
  /** Flows reported for the forecast quarter itself. */
  quarterFlows: FactRef[];
  /** Sources newly public between the cutoff and the reveal. */
  newSources: { id: string; title: string; url?: string; publishedOn: ISODate }[];
  /** True when every scored figure came in above its forecast. */
  allAbove: boolean;
  allBelow: boolean;
  actual: { usable: QuarterPoint | null; total: QuarterPoint | null };
}

/**
 * The reveal: saved forecast against what was reported next. Uses the reveal record's
 * comparisons and the evidence view frozen with it, never a fresh read of later data.
 */
export function deriveReveal(
  frozenView: HistoricalCase,
  run: HistoricalRun,
  reveal: { runId: string; revealedThrough: string; comparisons: HistoricalComparison[] },
): RevealView {
  if (reveal.runId !== run.id) throw new RewindError("The reveal belongs to another run");
  const view = atCutoff(frozenView, reveal.revealedThrough);
  const byId = new Map(view.facts.map((f) => [f.id, f]));
  const rows: RevealRow[] = reveal.comparisons.flatMap((c) => {
    if (c.status !== "scored") return [];
    const p = run.predictions.find((x) => x.id === c.predictionId);
    const f = byId.get(c.observationFactId);
    if (!p || !f || p.period.kind !== "instant") return [];
    return [
      {
        predictionId: p.id,
        metric: p.metric,
        label: METRIC_TEXT[p.metric] ?? p.metric,
        date: p.period.date,
        forecast: c.predictedCents,
        actual: c.observedCents,
        difference: c.errorCents,
        fact: ref(f, view),
      },
    ];
  });
  const origin = run.originBalanceDate;
  const quarterFlows = view.facts
    .filter(
      (f) =>
        f.period.kind === "duration" &&
        dayNumber(f.period.start) === dayNumber(origin) + 1 &&
        at(f.availableAt) > at(run.knowledgeCutoff),
    )
    .map((f) => ref(f, view));
  const pt = (metric: HistoricalMetric): QuarterPoint | null => {
    const row = rows.find((x) => x.metric === metric);
    return row
      ? { date: row.date, cents: row.actual, kind: "reported", ref: row.fact.factId }
      : null;
  };
  return {
    revealedThrough: localDate(reveal.revealedThrough),
    rows,
    quarterFlows,
    newSources: view.sources
      .filter((s) => at(s.publishedAt) > at(run.knowledgeCutoff))
      .map((s) => ({
        id: s.id,
        title: s.title,
        ...(/^https?:\/\//i.test(s.url) ? { url: s.url } : {}),
        publishedOn: localDate(s.publishedAt),
      })),
    allAbove: rows.length > 0 && rows.every((x) => x.difference > 0),
    allBelow: rows.length > 0 && rows.every((x) => x.difference < 0),
    actual: { usable: pt("cash_and_equivalents"), total: pt("cash_including_restricted") },
  };
}

export { shortDate };
