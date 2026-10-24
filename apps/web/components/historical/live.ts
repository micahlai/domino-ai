import {
  CentsSchema,
  type HistoricalAssumption,
  HistoricalAssumptionSchema,
  HistoricalCaseSchema,
  type HistoricalComparison,
  HistoricalComparisonSchema,
  type HistoricalFact,
  HistoricalFactSchema,
  type HistoricalPrediction,
  HistoricalRunSchema,
  type HistoricalSource,
  HistoricalSourceSchema,
  type ISODate,
  ISODateSchema,
  TimestampSchema,
} from "@domino/contracts";
import { z } from "zod";
import { formatCents } from "../../lib/format";
import { formatReportDate } from "./format";
import type {
  AlternativeView,
  CashPoint,
  ComparisonRow,
  HistoricalEvidence,
  HistoricalView,
} from "./types";

// Pure adapter from the accepted backend payloads onto the local view props. It formats and
// positions backend cents and maps data; it never forecasts, derives or recomputes an amount.
// Evidence rule: a saved forecast's inputs come from getRun().inputSnapshot only. getCase is the
// available (or frozen-at-reveal) evidence, used for the pre-save view and the revealed
// observations. The two are never overlaid.

export const CASE_ID = "twou-2023-cash-v1";
/** One metric for every number on the page. */
export const METRIC = "cash_and_equivalents";
export const METRIC_LABEL = "Cash and equivalents (restricted cash excluded)";

const cents = CentsSchema.safe();
const range = z.object({ low: cents, point: cents, high: cents });
const method = z.object({ id: z.string(), version: z.string() });

export const CaseDataSchema = z.object({
  case: HistoricalCaseSchema,
  knowledgeCutoff: TimestampSchema,
  originBalanceDate: ISODateSchema,
  visibleThrough: TimestampSchema,
  revealed: z.boolean(),
  disclosure: z.string(),
  method,
  projectionAssumptions: z.array(z.string()),
  riskRulesNote: z.string(),
});
export type CaseData = z.infer<typeof CaseDataSchema>;

const SnapshotSchema = z.object({
  caseId: z.string(),
  currency: z.string(),
  method,
  sources: z.array(HistoricalSourceSchema),
  facts: z.array(HistoricalFactSchema),
  assumptions: z.array(HistoricalAssumptionSchema),
});

const RunBase = z.object({
  runId: z.string(),
  run: HistoricalRunSchema,
  inputSnapshot: SnapshotSchema,
});
/** getRun for a baseline. Also what saveBaseline returns, minus the snapshot. */
export const BaselineDataSchema = RunBase.extend({ riskRulesNote: z.string() });
export const AlternativeDataSchema = RunBase.extend({
  costRelativeToBaseline: range,
  benefit: z.object({
    start: ISODateSchema,
    daysInWindow: z.number().int().nonnegative(),
    afterTarget: z.string(),
  }),
  postHoc: z.boolean(),
  postHocReason: z.string(),
  caveats: z.array(z.string()),
});
export type BaselineData = z.infer<typeof BaselineDataSchema>;
export type AlternativeData = z.infer<typeof AlternativeDataSchema>;

export const RevealDataSchema = z
  .object({
    runId: z.string(),
    revealedThrough: TimestampSchema,
    revealedAt: z.string(),
    comparisons: z.array(HistoricalComparisonSchema),
  })
  .nullable();
export type RevealData = z.infer<typeof RevealDataSchema>;

/** The calendar date as written in an offset timestamp (the contract's definition of local date). */
const localDate = (ts: string): ISODate => ts.slice(0, 10);

const instantDate = (f: { period: HistoricalFact["period"] }): ISODate | undefined =>
  f.period.kind === "instant" ? f.period.date : undefined;

const safeUrl = (url: string) => (/^https?:\/\//i.test(url) ? url : undefined);

const metricText: Record<string, string> = {
  cash_and_equivalents: "Cash and equivalents",
  restricted_cash: "Restricted cash",
  cash_including_restricted: "Cash including restricted cash",
  operating_cash_flow: "Operating cash flow",
  investing_cash_flow: "Investing cash flow",
  financing_cash_flow: "Financing cash flow",
  fx_effect_on_cash: "Exchange-rate effect on cash",
};

function periodText(p: HistoricalFact["period"]) {
  return p.kind === "instant"
    ? `on ${formatReportDate(p.date)}`
    : `${formatReportDate(p.start)} to ${formatReportDate(p.end)}`;
}

type Evidence = { sources: HistoricalSource[]; facts: HistoricalFact[] };

function factEvidence(f: HistoricalFact, e: Evidence, prefix: string): HistoricalEvidence {
  const label = `${f.id}: ${metricText[f.metric] ?? f.metric} ${periodText(f.period)}, ${formatCents(f.cents)}`;
  if (f.kind === "reported") {
    const s = e.sources.find((x) => x.id === f.sourceId);
    return {
      id: `${prefix}:${f.id}`,
      provenance: "reported",
      label,
      source: s?.title ?? f.sourceId,
      url: s ? safeUrl(s.url) : undefined,
      ids: `Source ${f.sourceId} · Fact ${f.id}`,
      publishedOn: localDate(f.availableAt),
      locator: f.locator,
      note: `Reported in ${f.reportedScale}, shown here in dollars.`,
    };
  }
  return {
    id: `${prefix}:${f.id}`,
    provenance: "derived",
    label,
    source: "Derived from reported facts",
    ids: `Fact ${f.id} from ${f.derivedFrom.join(", ")}`,
    publishedOn: localDate(f.availableAt),
    note: f.derivation,
  };
}

function assumptionEvidence(a: HistoricalAssumption, prefix: string): HistoricalEvidence {
  return {
    id: `${prefix}:${a.id}`,
    provenance: "assumption",
    label: `${a.id}: ${a.label} assumption`,
    source: "Assumption, not a reported figure",
    ids: [`Assumption ${a.id}`, a.basisFactIds.length ? `basis ${a.basisFactIds.join(", ")}` : ""]
      .filter(Boolean)
      .join(" · "),
    publishedOn: a.effectiveFrom,
    dateLabel: "Effective from",
    note: a.description,
  };
}

const forecastPoint = (p: HistoricalPrediction): CashPoint | undefined =>
  p.period.kind === "instant"
    ? {
        id: p.id,
        date: p.period.date,
        cash: p.cents,
        ...(p.range ? { low: p.range.low, high: p.range.high } : {}),
      }
    : undefined;

/** Select by metric and kind, never by a guessed prediction id. */
function pick(run: BaselineData["run"], kind: "nowcast" | "forecast") {
  return run.predictions.find((p) => p.metric === METRIC && p.kind === kind);
}

export function runEvidence(data: BaselineData): HistoricalEvidence[] {
  const { run, inputSnapshot: snap } = data;
  const cutoff = localDate(run.knowledgeCutoff);
  const common = {
    source: `Method ${run.method.id} v${run.method.version}`,
    publishedOn: localDate(run.createdAt),
    dateLabel: "Saved",
    ids: `Inputs: source ${run.inputs.sourceIds.join(", ")} · facts ${run.inputs.factIds.join(", ")} · assumptions ${run.inputs.assumptionIds.join(", ")}`,
  };
  return [
    ...snap.facts.map((f) => factEvidence(f, snap, "saved")),
    ...snap.assumptions.map((a) => assumptionEvidence(a, "saved")),
    {
      ...common,
      id: "saved:nowcast",
      provenance: "derived",
      label: "Cash estimate at the cutoff (modeled)",
      note: `A modeled estimate for ${formatReportDate(cutoff)}, not a reported balance. Input hash ${run.inputHash}.`,
    },
    {
      ...common,
      id: "saved:forecast",
      provenance: "derived",
      label: "Saved forecast",
      note: `Computed by the backend from the frozen inputs listed here, saved before this reveal and not edited after it. Input hash ${run.inputHash}.`,
    },
  ];
}

const lastReported = (snap: BaselineData["inputSnapshot"], origin: ISODate) =>
  snap.facts
    .filter((f) => f.metric === METRIC && instantDate(f))
    .map((f) => ({ f, d: instantDate(f) as ISODate }))
    .filter(({ d }) => d <= origin)
    .sort((a, b) => a.d.localeCompare(b.d))
    .at(-1);

const rowNote: Record<string, string> = {
  not_yet_published: "Not published yet.",
  no_observation: "No reported value exists for this date.",
  incomparable_scope: "The reported figure is not the same measure, so it is not compared.",
};

function comparisonRows(
  run: BaselineData["run"],
  comparisons: HistoricalComparison[],
): ComparisonRow[] {
  return run.predictions
    .filter((p) => p.metric === METRIC && p.period.kind === "instant")
    .flatMap((p): ComparisonRow[] => {
      const c = comparisons.find((x) => x.predictionId === p.id);
      const period = (p.period as { date: ISODate }).date;
      if (!c || c.status === "unscored")
        return [
          {
            period,
            projected: p.cents,
            outcome: "unscored",
            note: c ? rowNote[c.reason] : "Not compared.",
          },
        ];
      return [
        {
          period,
          projected: p.cents,
          observed: c.observedCents,
          difference: c.errorCents,
          outcome: "differs",
          note:
            c.errorCents === 0
              ? "Same as the saved forecast."
              : "No range was saved with this forecast, so it is not marked inside or outside one.",
        },
      ];
    });
}

export interface AlternativeIssue {
  message: string;
}

/** An alternative may be shown only under the baseline it was computed from. */
export function alternativeIssue(
  baseline: BaselineData,
  alt: AlternativeData,
): AlternativeIssue | undefined {
  const { branch } = alt.run;
  if (branch.kind !== "alternative")
    return { message: "That id is a saved baseline, not an alternative, so it is not shown." };
  if (alt.run.caseId !== baseline.run.caseId)
    return { message: "That alternative belongs to another case, so it is not shown." };
  if (branch.baselineRunId !== baseline.run.id)
    return {
      message:
        "That alternative was computed from a different baseline than the one on this page, so it is not shown.",
    };
  if (alt.run.knowledgeCutoff !== baseline.run.knowledgeCutoff)
    return { message: "That alternative uses a different cutoff, so it is not shown." };
  return undefined;
}

function alternativeView(alt: AlternativeData): AlternativeView | undefined {
  const { run, inputSnapshot: snap } = alt;
  if (run.branch.kind !== "alternative") return undefined;
  const decisionIds = run.branch.decisionAssumptionIds;
  const decisions = snap.assumptions.filter((a) => decisionIds.includes(a.id));
  const target = pick(run, "forecast");
  const point = target && forecastPoint(target);
  const cost = decisions.find((a) => a.oneTimeCost)?.oneTimeCost;
  const lag = decisions.find((a) => a.benefitLagDays !== undefined)?.benefitLagDays;
  if (!point || !cost) return undefined;
  const midpoint = alt.costRelativeToBaseline;
  return {
    label: `Alternative ${decisionIds.join(", ")} (hypothetical, cost only)`,
    postHoc: alt.postHoc,
    postHocReason: alt.postHocReason,
    // The frozen assumption range, as the cost of acting. The backend midpoint stays labelled.
    upfrontCost: { low: cost.low, high: cost.high },
    delayedBenefit: "unknown",
    benefitFrom: alt.benefit.start,
    benefitLagDays: lag,
    costRelativeToBaseline: { ...midpoint, date: point.date },
    downside: "unmodeled",
    downsideNote: "Not modeled and not included in any figure. It is a limit, not zero.",
    caveats: alt.caveats,
    assumptions: decisions.map((a) => ({
      text: `${a.id}: ${a.description}`,
      evidenceId: `alt:${a.id}`,
    })),
    path: [{ ...point, evidenceId: "alt:forecast" }],
  };
}

export interface ViewInput {
  caseData: CaseData;
  baseline?: BaselineData;
  reveal?: RevealData;
  alternative?: AlternativeData;
}

export function buildView({ caseData, baseline, reveal, alternative }: ViewInput): HistoricalView {
  const cutoff = localDate(caseData.knowledgeCutoff);
  // Revealed only when both the frozen case view and the reveal record agree.
  const revealed = Boolean(
    baseline && reveal && caseData.revealed && reveal.runId === baseline.run.id,
  );
  const common = {
    caseName: `${caseData.case.companyName} (historical case study)`,
    metricLabel: METRIC_LABEL,
    disclosure: caseData.disclosure,
    riskNote: caseData.riskRulesNote,
    projectionAssumptions: caseData.projectionAssumptions,
  };

  if (!baseline) {
    // Before a forecast is saved: only what was available at the cutoff (defensive re-filter).
    const at = (ts: string) => Date.parse(ts) <= Date.parse(caseData.knowledgeCutoff);
    const sources = caseData.case.sources.filter((s) => at(s.publishedAt));
    const facts = caseData.case.facts.filter((f) => at(f.availableAt));
    const reported: CashPoint[] = facts
      .filter((f) => f.metric === METRIC && f.period.kind === "instant")
      .map((f) => ({
        id: f.id,
        date: instantDate(f) as ISODate,
        cash: f.cents,
        evidenceId: `case:${f.id}`,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return {
      ...common,
      stage: "baseline",
      dates: {
        knowledgeCutoff: cutoff,
        lastReportedOn: caseData.originBalanceDate,
      },
      reported,
      projected: [],
      observed: [],
      comparison: [],
      evidence: [
        ...facts.map((f) => factEvidence(f, { sources, facts }, "case")),
        ...caseData.case.assumptions
          .filter((a) => a.label !== "counterfactual" && a.label !== "hindsight")
          .map((a) => assumptionEvidence(a, "case")),
      ],
    };
  }

  const { run, inputSnapshot: snap } = baseline;
  const origin = lastReported(snap, run.originBalanceDate);
  const nowcast = pick(run, "nowcast");
  const forecast = pick(run, "forecast");
  const nowPoint = nowcast && forecastPoint(nowcast);
  const targetPoint = forecast && forecastPoint(forecast);
  const comparisons = revealed && reveal ? reveal.comparisons : [];
  const observedFacts = new Map(caseData.case.facts.map((f) => [f.id, f]));
  const observed: CashPoint[] = comparisons.flatMap((c) => {
    const p = run.predictions.find((x) => x.id === c.predictionId);
    if (c.status !== "scored" || !p || p.metric !== METRIC || p.kind !== "forecast") return [];
    const date = p.period.kind === "instant" ? p.period.date : undefined;
    return date
      ? [{ id: c.id, date, cash: c.observedCents, evidenceId: `revealed:${c.observationFactId}` }]
      : [];
  });
  const revealedEvidence: HistoricalEvidence[] = comparisons.flatMap((c) => {
    const f = c.status === "scored" ? observedFacts.get(c.observationFactId) : undefined;
    return f ? [factEvidence(f, caseData.case, "revealed")] : [];
  });
  const alt = revealed && alternative ? alternativeView(alternative) : undefined;
  const altEvidence: HistoricalEvidence[] =
    alt && alternative
      ? [
          ...alternative.inputSnapshot.assumptions
            .filter((a) => alt.assumptions.some((x) => x.evidenceId === `alt:${a.id}`))
            .map((a) => assumptionEvidence(a, "alt")),
          {
            id: "alt:forecast",
            provenance: "assumption",
            label: "Alternative path (projected, cost only)",
            source: `Method ${alternative.run.method.id} v${alternative.run.method.version}`,
            ids: `Run ${alternative.run.id} · input hash ${alternative.run.inputHash}`,
            publishedOn: localDate(alternative.run.createdAt),
            dateLabel: "Saved",
            note: "A projection from assumptions, never compared with reported results.",
          },
        ]
      : [];
  const lastPoint: CashPoint | undefined = origin && {
    id: origin.f.id,
    date: origin.d,
    cash: origin.f.cents,
    evidenceId: `saved:${origin.f.id}`,
  };
  return {
    ...common,
    stage: alt ? "response" : revealed ? "observed" : "baseline",
    dates: {
      knowledgeCutoff: localDate(run.knowledgeCutoff),
      lastReportedOn: origin?.d ?? run.originBalanceDate,
      projectedThrough: targetPoint?.date,
      ...(revealed && reveal ? { revealedOn: localDate(reveal.revealedThrough) } : {}),
    },
    run: {
      runId: run.id,
      methodText: `${run.method.id} v${run.method.version}`,
      inputHash: run.inputHash,
      savedOn: localDate(run.createdAt),
    },
    reported: lastPoint ? [lastPoint] : [],
    ...(nowPoint ? { nowcast: { ...nowPoint, evidenceId: "saved:nowcast" } } : {}),
    projected: targetPoint ? [{ ...targetPoint, evidenceId: "saved:forecast" }] : [],
    observed,
    // Only a successful reveal produces rows: before it, nothing is compared or "not reported yet".
    comparison: revealed ? comparisonRows(run, comparisons) : [],
    ...(alt ? { alternative: alt } : {}),
    evidence: [...runEvidence(baseline), ...revealedEvidence, ...altEvidence],
  };
}

/** True only if a finished call may still touch the page: the session is mounted, the browser is
 * still on /historical, and its run query is the one the call started from (missing = new). */
export function mayApplyCompletion(args: {
  alive: boolean;
  pathname: string;
  search: string;
  originRunId?: string;
}) {
  const live = new URLSearchParams(args.search).get("run") || undefined;
  return args.alive && args.pathname === "/historical" && live === (args.originRunId || undefined);
}
