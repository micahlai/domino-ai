import { z } from "zod";
import { ChangeSchema } from "./branches";
import { ISODateSchema, IdSchema, SnapshotSchema, SourceKindSchema } from "./core";

/**
 * Simulator types. Only packages/sim creates these.
 * The engine, agents and web app may read WorldState.snapshot through connectors,
 * but NEVER the AnswerKey.
 */

export const CompanyProfileSchema = z.enum(["kestrel", "tally", "orbit"]);
export type CompanyProfile = z.infer<typeof CompanyProfileSchema>;

export const PlannedEventSchema = z.object({
  week: z.number().int().nonnegative(),
  label: z.string(),
  change: ChangeSchema,
});
export type PlannedEvent = z.infer<typeof PlannedEventSchema>;

export const WorldStateSchema = z.object({
  companyId: IdSchema,
  profile: CompanyProfileSchema,
  seed: z.number().int(),
  /** Simulated week number, 0 = first week of history */
  week: z.number().int().nonnegative(),
  today: ISODateSchema,
  snapshot: SnapshotSchema,
  /** Future events the simulator will apply. Hidden from Domino. */
  pendingEvents: z.array(PlannedEventSchema),
});
export type WorldState = z.infer<typeof WorldStateSchema>;

export const PlantedErrorSchema = z.object({
  kind: z.enum([
    "duplicate_bill",
    "bank_details_changed",
    "restricted_cash_counted",
    "payment_misapplied",
    "card_charge_no_receipt",
    "won_deal_unsigned",
  ]),
  ref: z.string(),
  note: z.string(),
});
export type PlantedError = z.infer<typeof PlantedErrorSchema>;

export const AnswerKeySchema = z.object({
  companyId: IdSchema,
  plannedEvents: z.array(PlannedEventSchema),
  plantedErrors: z.array(PlantedErrorSchema),
  /** True average payment delay per customer, in days */
  trueDelays: z.record(IdSchema, z.number()),
  /** Correct field mapping per source, to grade the connector agent */
  trueMappings: z.record(z.string(), z.record(z.string(), z.string())),
});
export type AnswerKey = z.infer<typeof AnswerKeySchema>;

/** Output of the mapSource agent: how one source's fields map to canonical fields. */
export const FieldMappingSchema = z.object({
  source: SourceKindSchema,
  /** Which canonical record this maps to, for example "invoices" */
  entity: z.enum(["customers", "invoices", "bankTxns", "bills", "cardTxns", "payroll", "deals"]),
  /** canonical field -> source field path, for example { amount: "amount_due" } */
  fields: z.record(z.string(), z.string()),
  /** Plain notes on conversions, for example "amount is in dollars, multiply by 100" */
  transforms: z.array(z.string()),
  endpoint: z.string(),
});
export type FieldMapping = z.infer<typeof FieldMappingSchema>;
