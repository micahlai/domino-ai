import { z } from "zod";
import { ChangeSchema } from "./branches";
import {
  CalendarDateSchema,
  SafeCentsSchema,
  flagRepeats,
  groupBy,
  isCalendarDate,
} from "./checks";
import { BankTxnSchema, ISODateSchema, IdSchema, SnapshotSchema, SourceKindSchema } from "./core";

/**
 * Simulator types. Only packages/sim creates these.
 * The engine, agents and web app may read WorldState.snapshot through connectors,
 * but NEVER the AnswerKey.
 */

export const CompanyProfileSchema = z.enum(["kestrel", "tally", "orbit"]);
export type CompanyProfile = z.infer<typeof CompanyProfileSchema>;

export const PlannedEventSchema = z.object({
  /** Stable identity; required while WorldState.runtime is present. */
  id: IdSchema.optional(),
  week: z.number().int().nonnegative(),
  label: z.string(),
  change: ChangeSchema,
});
export type PlannedEvent = z.infer<typeof PlannedEventSchema>;

const ScheduledCollectionSchema = z
  .object({
    invoiceId: IdSchema,
    payOn: CalendarDateSchema,
    payoutOn: CalendarDateSchema,
    grossAmount: SafeCentsSchema.nonnegative(),
    netAmount: SafeCentsSchema.nonnegative(),
  })
  .superRefine((collection, ctx) => {
    const issue = (path: string[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    if (collection.payoutOn < collection.payOn)
      issue(["payoutOn"], "payout cannot precede payment");
    if (collection.netAmount > collection.grossAmount)
      issue(["netAmount"], "net cannot exceed gross");
  });

/**
 * Simulator-private schedule, version 1. Hidden outcomes until observed: never emit
 * through source APIs or read from engine, agents or connectors.
 */
export const WorldRuntimeSchema = z
  .object({
    version: z.literal(1),
    collections: z.array(ScheduledCollectionSchema),
    billPayments: z.array(z.object({ billId: IdSchema, payOn: CalendarDateSchema })),
    /** Scheduled synthetic one-off bank postings */
    cashEvents: z.array(
      BankTxnSchema.extend({ date: CalendarDateSchema, amount: SafeCentsSchema }),
    ),
    appliedEvents: z.array(
      z.object({ id: IdSchema, week: z.number().int().nonnegative(), change: ChangeSchema }),
    ),
  })
  .superRefine((runtime, ctx) => {
    const repeats = <T>(
      list: "collections" | "billPayments" | "cashEvents" | "appliedEvents",
      items: T[],
      key: (item: T) => string,
      field: string,
    ) => flagRepeats(ctx, items, key, (index) => [list, index, field], `repeated ${list} ${field}`);
    repeats("collections", runtime.collections, (c) => c.invoiceId, "invoiceId");
    repeats("billPayments", runtime.billPayments, (b) => b.billId, "billId");
    repeats("cashEvents", runtime.cashEvents, (e) => e.id, "id");
    repeats("appliedEvents", runtime.appliedEvents, (e) => e.id, "id");
  });
export type WorldRuntime = z.infer<typeof WorldRuntimeSchema>;

export const WorldStateSchema = z
  .object({
    companyId: IdSchema,
    profile: CompanyProfileSchema,
    seed: z.number().int(),
    /** Simulated week number, 0 = first week of history */
    week: z.number().int().nonnegative(),
    today: ISODateSchema,
    snapshot: SnapshotSchema,
    /** Future events the simulator will apply. Hidden from Domino. */
    pendingEvents: z.array(PlannedEventSchema),
    /** Missing on legacy worlds; an advance may reject them rather than guess the schedule. */
    runtime: WorldRuntimeSchema.optional(),
  })
  .superRefine((world, ctx) => {
    const { runtime, snapshot } = world;
    if (!runtime) return;
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    if (!isCalendarDate(world.today) || world.today !== snapshot.asOf)
      issue(["today"], "a runtime world needs a real today equal to snapshot.asOf");

    const applied = new Set(runtime.appliedEvents.map((event) => event.id));
    const pending = new Set<string>();
    for (const [index, event] of world.pendingEvents.entries()) {
      if (event.id === undefined)
        issue(["pendingEvents", index, "id"], "pending events need an id");
      else if (pending.has(event.id))
        issue(["pendingEvents", index, "id"], "repeated pending event id");
      else if (applied.has(event.id))
        issue(["pendingEvents", index, "id"], "event was already applied");
      if (event.id !== undefined) pending.add(event.id);
    }
    for (const [index, event] of runtime.appliedEvents.entries()) {
      if (event.week > world.week)
        issue(
          ["runtime", "appliedEvents", index, "week"],
          "an applied event cannot be after world.week",
        );
    }

    const invoices = groupBy(snapshot.invoices, (invoice) => invoice.id);
    for (const [index, collection] of runtime.collections.entries()) {
      const matches = invoices.get(collection.invoiceId) ?? [];
      const invoice = matches[0];
      if (matches.length !== 1 || !invoice)
        issue(
          ["runtime", "collections", index, "invoiceId"],
          "collection invoice must exist exactly once",
        );
      else if (collection.grossAmount > invoice.amount)
        issue(
          ["runtime", "collections", index, "grossAmount"],
          "gross cannot exceed the invoice amount",
        );
    }
    const bills = groupBy(snapshot.bills, (bill) => bill.id);
    for (const [index, payment] of runtime.billPayments.entries()) {
      if ((bills.get(payment.billId) ?? []).length !== 1)
        issue(["runtime", "billPayments", index, "billId"], "payment bill must exist exactly once");
    }
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
  entity: z.enum([
    "customers",
    "invoices",
    "bankTxns",
    "bills",
    "cardTxns",
    "payroll",
    "deals",
    "billingPlans",
    "pendingPayouts",
  ]),
  /** canonical field -> source field path, for example { amount: "amount_due" } */
  fields: z.record(z.string(), z.string()),
  /** Plain notes on conversions, for example "amount is in dollars, multiply by 100" */
  transforms: z.array(z.string()),
  endpoint: z.string(),
});
export type FieldMapping = z.infer<typeof FieldMappingSchema>;
