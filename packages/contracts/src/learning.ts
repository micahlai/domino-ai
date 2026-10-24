import { z } from "zod";
import { CalendarDateSchema, isCalendarDate } from "./checks";
import { BankTxnSchema, SnapshotSchema } from "./core";

/**
 * Explicit observation windows for grading and retrospective learning.
 * Without them the engine would have to guess when a forecast started and which
 * records were known at the time. Cross-call facts (same company as the current
 * snapshot, cutoff not after it, forecast calendar) are checked by the engine.
 */

/**
 * The caller asserts it supplied every bank transaction in the window. This is a
 * caller responsibility, not proof the external bank feed was complete.
 */
const BankWindowCompleteSchema = z.literal(true);

function requireLater(
  ctx: z.RefinementCtx,
  start: string,
  end: string,
  path: (string | number)[],
): void {
  // Same-shape ISO dates order correctly as strings.
  if (isCalendarDate(start) && isCalendarDate(end) && end <= start) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path, message: "asOf must be after the origin" });
  }
}

/**
 * Grading window. Starting cash is the end-of-day balance on forecastAsOf; actualBank
 * holds every bank transaction strictly after forecastAsOf through asOf. An empty
 * actualBank is a known quiet window.
 */
export const GradeContextSchema = z
  .object({
    forecastAsOf: CalendarDateSchema,
    asOf: CalendarDateSchema,
    bankWindowComplete: BankWindowCompleteSchema,
  })
  .superRefine((context, ctx) => requireLater(ctx, context.forecastAsOf, context.asOf, ["asOf"]));
export type GradeContext = z.infer<typeof GradeContextSchema>;

/** Records whose date means "already happened" and so cannot postdate the origin. */
const OBSERVED_DATES = [
  ["invoices", "paid"],
  ["invoices", "writtenOff"],
  ["bills", "paid"],
  ["bankTxns", "date"],
  ["cardTxns", "date"],
] as const;

/**
 * One replay origin. snapshot is the authentic stored snapshot as it was on its asOf,
 * not one rebuilt from today's outcomes. actualBank holds every bank transaction
 * strictly after snapshot.asOf through asOf. Plans (payroll dates, invoice due dates,
 * deal expectedClose) may lie after the origin; observed outcomes may not.
 */
export const LearningExampleSchema = z
  .object({
    snapshot: SnapshotSchema,
    actualBank: z.array(BankTxnSchema),
    asOf: CalendarDateSchema,
    bankWindowComplete: BankWindowCompleteSchema,
  })
  .superRefine((example, ctx) => {
    const origin = example.snapshot.asOf;
    if (!isCalendarDate(origin)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["snapshot", "asOf"],
        message: "expected a real calendar date",
      });
      return;
    }
    requireLater(ctx, origin, example.asOf, ["asOf"]);
    for (const [records, field] of OBSERVED_DATES) {
      for (const [index, record] of example.snapshot[records].entries()) {
        const date: unknown = (record as Record<string, unknown>)[field];
        if (typeof date === "string" && date > origin) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["snapshot", records, index, field],
            message: "origin snapshot contains an outcome observed after its asOf",
          });
        }
      }
    }
  });
export type LearningExample = z.infer<typeof LearningExampleSchema>;

/**
 * Authoritative replay evidence for Engine.learn. Each origin (companyId + snapshot.asOf)
 * appears once so a repeated window cannot gain extra weight. Empty means no evidence.
 */
export const LearnContextSchema = z
  .object({
    examples: z.array(LearningExampleSchema),
  })
  .superRefine((context, ctx) => {
    const seen = new Set<string>();
    for (const [index, { snapshot }] of context.examples.entries()) {
      const origin = JSON.stringify([snapshot.companyId, snapshot.asOf]);
      if (seen.has(origin)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["examples", index],
          message: "each origin (companyId and snapshot.asOf) may appear only once",
        });
      }
      seen.add(origin);
    }
  });
export type LearnContext = z.infer<typeof LearnContextSchema>;
