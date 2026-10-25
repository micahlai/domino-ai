import { z } from "zod";
import { CalendarDateSchema } from "./checks";
import { SnapshotSchema } from "./core";
import { DomainIdSchema, exactBoundarySchema, safeParseJsonText } from "./feature-boundary";
import { Sha256Schema, TimestampSchema } from "./historical";

/**
 * Weekly seam v2 (P0 v2): Field exports a hashed weekly company state (WeeklySeedV1) and
 * Timeline returns result references (WeeklyResultRefV1). Same rules as the P0-C boundary in
 * feature-boundary.ts: JSON text only through the parse*Json functions below (total, never
 * throw), every record equals its own parse (unknown fields and omitted defaults rejected),
 * every number a bounded safe integer, hash scheme FEATURE_BOUNDARY_HASH. A seed's
 * contentHash digests contentHashPreimage(seed). Schemas check shape only: consumers recompute
 * the digest. Operations reuse OperationSummaryV1 unchanged. The weekly Snapshot is reused
 * unchanged. Money is integer cents.
 */

const DAY_MS = 86_400_000;
const ms = (date: string) => Date.parse(`${date}T00:00:00Z`);
const isMonday = (date: string) => new Date(ms(date)).getUTCDay() === 1;
/** The engine's first forecast week: the first Monday strictly after asOf (weekStarts). */
export function firstForecastWeek(asOf: string): string {
  const dow = new Date(ms(asOf)).getUTCDay();
  return new Date(ms(asOf) + ((8 - dow) % 7 || 7) * DAY_MS).toISOString().slice(0, 10);
}
/** 13 weekly buckets: asOf is week 0, asOf + 12 weeks is the last. */
export const WEEKLY_HORIZON_WEEKS = 13;

const Text = (max: number) =>
  z
    .string()
    .max(max)
    .refine((s) => s.trim().length > 0, "must not be blank");
const MondaySchema = CalendarDateSchema.refine(isMonday, "expected a Monday (ISO week start)");
const issue = (ctx: z.RefinementCtx, path: (string | number)[], message: string) =>
  ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

const WeeklySeedIdSchema = DomainIdSchema.refine(
  (id) => id.startsWith("field:weekly_seed/"),
  "expected a field:weekly_seed/ domain id",
);

export const ScheduledItemSchema = z
  .object({
    id: Text(128),
    kind: z.enum(["receivable", "payable", "payroll", "other"]),
    counterparty: Text(200),
    /** Monday of the forecast week the item lands in. */
    dueWeek: MondaySchema,
    /** Signed integer cents: inflow positive, outflow negative. */
    cents: z.number().int(),
    status: z.enum(["expected", "confirmed", "at_risk"]),
    /** Id of the snapshot record the item comes from. */
    sourceRef: Text(128),
  })
  .strict()
  .superRefine((item, ctx) => {
    if (item.kind === "receivable" && item.cents <= 0)
      issue(ctx, ["cents"], "a receivable is an inflow (positive cents)");
    if ((item.kind === "payable" || item.kind === "payroll") && item.cents >= 0)
      issue(ctx, ["cents"], "a payable or payroll item is an outflow (negative cents)");
  });
export type ScheduledItem = z.infer<typeof ScheduledItemSchema>;

export const FindingSchema = z
  .object({
    id: Text(128),
    kind: z.enum(["duplicate", "conflict", "unusual_amount", "unusual_timing", "missing_expected"]),
    severity: z.enum(["low", "medium", "high"]),
    summary: Text(500),
    /** Snapshot record or scheduled item ids the finding is about. */
    refs: z.array(Text(128)).min(1).max(64),
    detectedAt: TimestampSchema,
  })
  .strict();
export type Finding = z.infer<typeof FindingSchema>;

const WeeklySeedObjectSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: WeeklySeedIdSchema,
    exportedAt: TimestampSchema,
    company: z.object({ id: Text(128), name: Text(200) }).strict(),
    /** Week 0 of the 13-week horizon: the engine's first forecast week for snapshot.asOf. */
    asOf: MondaySchema,
    snapshot: SnapshotSchema,
    scheduledItems: z.array(ScheduledItemSchema).max(2000),
    findings: z.array(FindingSchema).max(500),
    contentHash: Sha256Schema,
  })
  .strict()
  .superRefine((seed, ctx) => {
    const s = seed.snapshot;
    if (seed.company.id !== s.companyId)
      issue(ctx, ["company", "id"], "company id differs from the snapshot company");
    if (seed.asOf !== firstForecastWeek(s.asOf))
      issue(
        ctx,
        ["asOf"],
        "asOf must be the first forecast week (first Monday after snapshot.asOf)",
      );
    const last = ms(seed.asOf) + (WEEKLY_HORIZON_WEEKS - 1) * 7 * DAY_MS;
    const records = new Set(
      [s.customers, s.invoices, s.bankTxns, s.bills, s.cardTxns, s.payroll, s.deals].flatMap(
        (list) => list.map((r) => r.id),
      ),
    );
    const ids = new Set<string>();
    const unique = (id: string, path: (string | number)[]) => {
      if (ids.has(id)) issue(ctx, path, "repeated id");
      ids.add(id);
    };
    seed.scheduledItems.forEach((item, i) => {
      unique(item.id, ["scheduledItems", i, "id"]);
      const due = ms(item.dueWeek);
      if (due < ms(seed.asOf) || due > last)
        issue(ctx, ["scheduledItems", i, "dueWeek"], "dueWeek is outside asOf..asOf+12 weeks");
      if (!records.has(item.sourceRef))
        issue(ctx, ["scheduledItems", i, "sourceRef"], "sourceRef names no snapshot record");
    });
    seed.findings.forEach((f, i) => {
      unique(f.id, ["findings", i, "id"]);
      f.refs.forEach((ref, j) => {
        if (!records.has(ref) && !seed.scheduledItems.some((x) => x.id === ref))
          issue(ctx, ["findings", i, "refs", j], "ref names no snapshot record or scheduled item");
      });
      if (Date.parse(f.detectedAt) > Date.parse(seed.exportedAt))
        issue(ctx, ["findings", i, "detectedAt"], "detected after the seed was exported");
    });
  });

export const WeeklySeedV1Schema = exactBoundarySchema(WeeklySeedObjectSchema);
export type WeeklySeedV1 = z.infer<typeof WeeklySeedObjectSchema>;

const WeeklyResultRefObjectSchema = z
  .object({
    seedId: WeeklySeedIdSchema,
    seedHash: Sha256Schema,
    kind: z.enum(["forecast", "scenario", "auto_analysis"]),
    /** Timeline-owned branch domain ids, for example timeline:branch/acme-late. */
    branchIds: z
      .array(DomainIdSchema.refine((id) => id.startsWith("timeline:"), "expected a timeline: id"))
      .max(64)
      .refine((ids) => new Set(ids).size === ids.length, "repeated branch id"),
    /** App route that opens the result, for example /c/kestrel. */
    route: z
      .string()
      .max(256)
      .regex(/^\/[^\s]*$/, "expected an app route starting with /"),
    health: z
      .object({
        rating: z.enum(["ok", "watch", "at_risk"]),
        lowPointCents: z.number().int(),
        lowPointWeek: MondaySchema,
      })
      .strict()
      .optional(),
  })
  .strict();

/** Read-only pointer from Timeline back to a weekly seed. */
export const WeeklyResultRefV1Schema = exactBoundarySchema(WeeklyResultRefObjectSchema);
export type WeeklyResultRefV1 = z.infer<typeof WeeklyResultRefObjectSchema>;

export const parseWeeklySeedJson = (text: unknown) => safeParseJsonText(WeeklySeedV1Schema, text);
export const parseWeeklyResultRefJson = (text: unknown) =>
  safeParseJsonText(WeeklyResultRefV1Schema, text);
