import { ChangeSchema } from "@domino/contracts";
import { z } from "zod";
import { FieldSourceSchema } from "../chat/brain";

export const PREDICT_METHOD = "timeline_predicted_scenario@1";
/** A whole prediction may take a few minutes; after this the row is marked failed. */
export const LEASE_MS = 6 * 60_000;
export const MAX_ACTIVITY = 24;

export const PredictionStatusSchema = z.enum(["queued", "running", "done", "failed"]);

/**
 * Saved state of one "predict knock-on effects" job for one scenario run. Progress and activity
 * are display only; the predicted line itself is a normal saved run (resultRunId).
 */
export const PredictionReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    methodVersion: z.literal(PREDICT_METHOD),
    predictionId: z.string(),
    companyId: z.string(),
    runId: z.string(),
    parentRunId: z.string(),
    inputHash: z.string(),
    /** Earliest date an effect may start: the scenario's own event. */
    floor: z.string().nullable(),
    field: FieldSourceSchema,
    status: PredictionStatusSchema,
    progress: z.number().int().min(0).max(100),
    stage: z.string().max(200),
    activity: z.array(z.object({ at: z.string(), text: z.string().max(300) }).strict()),
    summary: z.string().max(1200).nullable(),
    effects: z.array(
      z
        .object({
          title: z.string(),
          reason: z.string(),
          likelihood: z.enum(["likely", "possible"]),
          evidence: z.array(z.string()),
          change: ChangeSchema,
        })
        .strict(),
    ),
    rejected: z.array(z.object({ title: z.string(), reason: z.string() }).strict()),
    interest: z
      .object({
        annualBps: z.number().int(),
        weeks: z.number().int(),
        netCents: z.number().int(),
      })
      .strict()
      .nullable(),
    /** Management's response to having less cash; absent on predictions saved before it. */
    response: z
      .object({
        source: z.enum(["agents", "default"]),
        respondFrom: z.enum(["breach", "event"]),
        floor: z.number().int().nullable(),
        growthSpend: z.array(z.string()),
        spendCutPercent: z.number(),
        reactionDays: z.number().int(),
        growthSensitivity: z.number(),
        revenueLagDays: z.number().int(),
        likelihood: z.enum(["likely", "possible"]),
        reason: z.string(),
        evidence: z.array(z.string()),
        trigger: z
          .object({ date: z.string(), usable: z.number().int().nullable() })
          .strict()
          .nullable(),
        notes: z.array(z.string()),
        applied: z.boolean(),
        skipped: z.string().nullable(),
      })
      .strict()
      .nullable()
      .optional(),
    /** Which saved stories the agents were given, nearest scenario first. */
    context: z
      .array(
        z
          .object({
            label: z.string(),
            relation: z.enum(["this scenario", "builds on"]),
            sources: z.array(z.string()),
          })
          .strict(),
      )
      .optional(),
    resultRunId: z.string().nullable(),
    warnings: z.array(z.string()),
    error: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
export type PredictionReceipt = z.infer<typeof PredictionReceiptSchema>;

/** What the finished job writes back in one step. */
export const PredictionOutcomeSchema = PredictionReceiptSchema.pick({
  summary: true,
  effects: true,
  rejected: true,
  interest: true,
  response: true,
  context: true,
  resultRunId: true,
  warnings: true,
  error: true,
});
export type PredictionOutcome = z.infer<typeof PredictionOutcomeSchema>;
