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
  projectedThrough: ISODate;
  /** Publication date of the disclosure that was revealed. Absent before reveal. */
  revealedOn?: ISODate;
}

export interface ComparisonRow {
  period: ISODate;
  projected: Cents;
  observed?: Cents;
  /** Reported minus saved forecast, signed, from the backend. */
  difference?: Cents;
  outcome: "within_range" | "miss" | "unscored";
  note?: string;
}

export interface AlternativeView {
  label: string;
  /** Labelled post-hoc when it was chosen or tuned after the reveal. */
  postHoc: boolean;
  upfrontCost: Cents;
  delayedBenefit: Cents;
  benefitFrom: ISODate;
  downside: Cents;
  downsideNote: string;
  assumptions: { text: string; evidenceId?: string }[];
  path: CashPoint[];
}

export interface HistoricalView {
  caseName: string;
  /** What the viewer is looking at: baseline -> observed -> response. */
  stage: "baseline" | "observed" | "response";
  dates: HistoricalDates;
  /** Reported balances, only at the frequency the filings support. */
  reported: CashPoint[];
  /** Saved forecast, starting from the last reported point. Stays after reveal. */
  projected: CashPoint[];
  /** Reported results published after the forecast was saved. Empty before reveal. */
  observed: CashPoint[];
  comparison: ComparisonRow[];
  alternative?: AlternativeView;
  threshold?: { cents: Cents; label: string };
  evidence: HistoricalEvidence[];
}
