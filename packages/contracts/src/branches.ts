import { z } from "zod";
import { CentsSchema, CompanyModelSchema, EvidenceSchema, ISODateSchema, IdSchema } from "./core";

/**
 * Branches of the timeline. The base branch is the normal forecast.
 * Event branches add one risky event. Fix branches add fixes under an event.
 * A Change is always relative to the parent branch.
 */

export const ChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("delay_invoice"), invoiceId: IdSchema, days: z.number().int() }),
  z.object({ kind: z.literal("lose_invoice"), invoiceId: IdSchema }),
  z.object({ kind: z.literal("churn"), customerId: IdSchema, fromDate: ISODateSchema }),
  z.object({
    kind: z.literal("add_cash"),
    date: ISODateSchema,
    amount: CentsSchema,
    label: z.string(),
  }),
  z.object({
    kind: z.literal("remove_cash"),
    date: ISODateSchema,
    amount: CentsSchema,
    label: z.string(),
  }),
  z.object({ kind: z.literal("delay_bill"), billId: IdSchema, days: z.number().int() }),
  z.object({
    kind: z.literal("discount_early_pay"),
    invoiceId: IdSchema,
    percent: z.number().min(0).max(100),
    payOn: ISODateSchema,
  }),
  z.object({
    kind: z.literal("shift_hire"),
    label: z.string(),
    monthlyCost: CentsSchema,
    fromDate: ISODateSchema,
    toDate: ISODateSchema,
  }),
]);
export type Change = z.infer<typeof ChangeSchema>;
export type ChangeKind = Change["kind"];

export const ForecastWeekSchema = z.object({
  weekStart: ISODateSchema,
  opening: CentsSchema,
  inflow: CentsSchema,
  /** Positive number: money going out this week */
  outflow: CentsSchema,
  closing: CentsSchema,
  /** closing minus restricted cash */
  usable: CentsSchema,
});
export type ForecastWeek = z.infer<typeof ForecastWeekSchema>;

export const ForecastSchema = z.object({
  weeks: z.array(ForecastWeekSchema).length(13),
  lowPoint: z.object({ weekStart: ISODateSchema, usable: CentsSchema }),
});
export type Forecast = z.infer<typeof ForecastSchema>;

export const DominoContextSchema = z.object({
  model: CompanyModelSchema,
  /** Complete ordered scenario, including ancestor and current changes exactly once. */
  changes: z.array(ChangeSchema),
  /** Counterfactual forecast used for comparison. */
  baseline: ForecastSchema.optional(),
});
export type DominoContext = z.infer<typeof DominoContextSchema>;

export const FixScoreContextSchema = z.object({
  /** Root-to-parent order, excluding parent.changes and fix.changes. */
  ancestorChanges: z.array(ChangeSchema),
});
export type FixScoreContext = z.infer<typeof FixScoreContextSchema>;

export const DominoSchema = z.object({
  order: z.number().int().positive(),
  weekStart: ISODateSchema,
  /** Plain words, for example "Usable cash falls below $3M" */
  label: z.string().min(1),
  /** Which constraint it breaks, if any */
  constraintId: IdSchema.optional(),
  /** order of the domino that caused this one */
  causedBy: z.number().int().positive().optional(),
  evidence: z.array(EvidenceSchema),
});
export type Domino = z.infer<typeof DominoSchema>;

export const BranchKindSchema = z.enum(["base", "event", "fix"]);
export type BranchKind = z.infer<typeof BranchKindSchema>;

export const BranchStatusSchema = z.enum(["draft", "proposed", "approved", "rejected"]);
export type BranchStatus = z.infer<typeof BranchStatusSchema>;

const RiskIdsSchema = z.array(IdSchema).refine((ids) => new Set(ids).size === ids.length, {
  message: "risk IDs must not contain duplicates",
});

export const BranchSchema = z.object({
  id: IdSchema,
  parentId: IdSchema.nullable(),
  kind: BranchKindSchema,
  label: z.string().min(1),
  /** Events only: chance from 0 to 1 */
  probability: z.number().min(0).max(1).optional(),
  changes: z.array(ChangeSchema),
  forecast: ForecastSchema,
  dominoes: z.array(DominoSchema),
  status: BranchStatusSchema,
  /** Cumulative known risks; missing = unknown legacy context; [] = base/no risks. */
  riskIds: RiskIdsSchema.optional(),
});
export type Branch = z.infer<typeof BranchSchema>;

export const RiskEventSchema = z.object({
  id: IdSchema,
  label: z.string().min(1),
  probability: z.number().min(0).max(1),
  /** How much lower the cash low point gets if this happens (positive cents) */
  impactLowPoint: CentsSchema,
  changes: z.array(ChangeSchema),
  evidence: z.array(EvidenceSchema),
});
export type RiskEvent = z.infer<typeof RiskEventSchema>;

export const FixRiskSchema = z.enum(["low", "medium", "high"]);

export const FixCandidateSchema = z.object({
  id: IdSchema,
  label: z.string().min(1),
  changes: z.array(ChangeSchema).min(1),
  /** Plain sentence on what the fix costs, for example "Gives up 2% of a $240K invoice" */
  costNote: z.string(),
  risk: FixRiskSchema,
  evidence: z.array(EvidenceSchema),
  /** Missing = unknown legacy target; [] = global; otherwise applies to any listed risk. */
  targetRiskIds: RiskIdsSchema.optional(),
});
export type FixCandidate = z.infer<typeof FixCandidateSchema>;

// ---------- Multiverse timeline (the hero visual) ----------

/** One week of real history, for the left side of the timeline. */
export const HistoryWeekSchema = z.object({
  weekStart: ISODateSchema,
  closing: CentsSchema,
  usable: CentsSchema,
});
export type HistoryWeek = z.infer<typeof HistoryWeekSchema>;

/** Something that really happened, shown as a marker on the past side of the timeline. */
export const PastEventSchema = z.object({
  id: IdSchema,
  date: ISODateSchema,
  label: z.string().min(1),
  kind: z.enum(["late_payment", "churn", "big_deal", "spend_spike", "hire", "other"]),
  /** Cash effect, positive or negative cents */
  amount: CentsSchema.optional(),
  evidence: z.array(EvidenceSchema),
});
export type PastEvent = z.infer<typeof PastEventSchema>;

/**
 * One possible future: the base plus one or more risk events (and optional fixes).
 * Many universes together fan out from "today" on the timeline.
 */
export const UniverseSchema = z.object({
  id: IdSchema,
  label: z.string().min(1),
  riskIds: z.array(IdSchema),
  fixIds: z.array(IdSchema),
  /** Chance of this universe, 0 to 1 (product of its risks' chances) */
  probability: z.number().min(0).max(1),
  survives: z.boolean(),
  /** First week a rule breaks, if it does not survive */
  breaksAt: ISODateSchema.optional(),
  /** Which constraint breaks first */
  brokenConstraintId: IdSchema.optional(),
  forecast: ForecastSchema,
});
export type Universe = z.infer<typeof UniverseSchema>;

/** The smallest shock that breaks the company, for example "Acme paying 38 or more days late". */
export const BreakingPointSchema = z.object({
  label: z.string().min(1),
  /** For example 38 (days late) or 18000000 (cents lost) */
  threshold: z.number(),
  unit: z.enum(["days_late", "cents_lost", "percent_churn"]),
});
export type BreakingPoint = z.infer<typeof BreakingPointSchema>;

export const ResilienceReportSchema = z.object({
  universes: z.array(UniverseSchema),
  /** Weighted scenario index, 0 to 1; overlapping universes are not a calibrated survival probability. */
  survivalRate: z.number().min(0).max(1),
  survivedCount: z.number().int().nonnegative(),
  breakingPoints: z.array(BreakingPointSchema),
  /** Fixes selected for this report, applied only to matching universes (empty = no fixes). */
  appliedFixIds: z.array(IdSchema),
});
export type ResilienceReport = z.infer<typeof ResilienceReportSchema>;
