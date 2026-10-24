import type { Cents, ISODate } from "@domino/contracts";

// Local view props for the historical replay. These are NOT shared schemas: the backend packet
// is not frozen, so the live adapter (pending) maps its payload onto these shapes. Every money
// field is backend-provided integer cents; components only format and position them.

/** reported = in a filing; derived = computed by backend from reported facts; assumption =
 * counterfactual or analyst input; synthetic = invented operational detail, never reported. */
export type Provenance = "reported" | "derived" | "assumption" | "synthetic";

export interface HistoricalEvidence {
  id: string;
  provenance: Provenance;
  label: string;
  source: string;
  publishedOn: ISODate;
  /** What `publishedOn` means. Defaults to "Published"; a saved forecast says "Saved". */
  dateLabel?: string;
  /** Proof link to the public source, http(s) only. */
  url?: string;
  /** Exact source, fact and assumption IDs behind this item. */
  ids?: string;
  locator?: string;
  quote?: string;
  note: string;
}

export interface CashPoint {
  id: string;
  /** Period end or balance date, never a publication date. */
  date: ISODate;
  cash: Cents;
  evidenceId?: string;
  /** Optional labelled assumption range, not a probability band. */
  low?: Cents;
  high?: Cents;
}

export interface HistoricalDates {
  knowledgeCutoff: ISODate;
  lastReportedOn: ISODate;
  /** Absent until a forecast is saved: the target date comes from the saved run. */
  projectedThrough?: ISODate;
  /** Publication date of the disclosure that was revealed. Absent before reveal. */
  revealedOn?: ISODate;
}

export interface ComparisonRow {
  period: ISODate;
  projected: Cents;
  observed?: Cents;
  /** Reported minus saved forecast, signed, from the backend. */
  difference?: Cents;
  /** "differs" = compared with no saved range to judge it against. */
  outcome: "within_range" | "miss" | "differs" | "unscored";
  note?: string;
}

/** Backend-supplied range in cents. `point` is the backend midpoint, an assumption, not an estimate. */
export interface CentsRange {
  low: Cents;
  point: Cents;
  high: Cents;
}

export interface AlternativeView {
  label: string;
  /** Post-hoc = the authors knew the outcome when they chose it, whatever the viewer clicked. */
  postHoc: boolean;
  postHocReason?: string;
  /** A range is shown as a range: the live alternative's cost is an assumption range. */
  upfrontCost: Cents | { low: Cents; high: Cents };
  /** "unknown" = not quantified by the backend; never drawn as zero. */
  delayedBenefit: Cents | "unknown";
  benefitFrom: ISODate;
  /** Days between the decision and the earliest first benefit. */
  benefitLagDays?: number;
  /** Alternative minus saved baseline at the target date, from the backend. */
  costRelativeToBaseline?: CentsRange & { date: ISODate };
  /** "unmodeled" = not in any figure; never drawn as zero. */
  downside: Cents | "unmodeled";
  downsideNote: string;
  /** Limits the backend states about this alternative. */
  caveats?: string[];
  assumptions: { text: string; evidenceId?: string }[];
  path: CashPoint[];
}

/** Facts about the saved run, shown as proof. Absent in the synthetic preview. */
export interface RunProof {
  runId: string;
  methodText: string;
  inputHash: string;
  savedOn: ISODate;
}

export interface HistoricalView {
  caseName: string;
  /** The single metric every number on the page uses. */
  metricLabel?: string;
  /** Plain statement of how this case was written (retrospective, outcome known). */
  disclosure?: string;
  riskNote?: string;
  projectionAssumptions?: string[];
  run?: RunProof;
  /** What the viewer is looking at: baseline -> observed -> response. */
  stage: "baseline" | "observed" | "response";
  dates: HistoricalDates;
  /** Reported balances, only at the frequency the filings support. */
  reported: CashPoint[];
  /** Backend-supplied modeled estimate at the knowledge cutoff. The saved forecast and any
   * alternative both pass through it, so they cannot diverge before the cutoff. Not a reported
   * value, and the UI never computes it. */
  nowcast?: CashPoint;
  /** Saved forecast, starting from the last reported point. Stays after reveal. */
  projected: CashPoint[];
  /** Reported results published after the forecast was saved. Empty before reveal. */
  observed: CashPoint[];
  comparison: ComparisonRow[];
  alternative?: AlternativeView;
  threshold?: { cents: Cents; label: string };
  evidence: HistoricalEvidence[];
}
