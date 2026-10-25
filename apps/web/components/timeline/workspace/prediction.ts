import { ChangeSchema } from "@domino/contracts";
import { makeFunctionReference } from "convex/server";
import { z } from "zod";

// Browser view of timeline/predict. Typed references by name only; every read is parsed here.

export type PredictionKey = { companyId: string; runId: string };
export type StartPredictionArgs = PredictionKey & { requestId: string };

export const PredictionSchema = z
  .object({
    predictionId: z.string(),
    runId: z.string(),
    status: z.enum(["queued", "running", "done", "failed"]),
    progress: z.number().min(0).max(100),
    stage: z.string(),
    activity: z.array(z.object({ at: z.string(), text: z.string() })),
    summary: z.string().nullable(),
    effects: z.array(
      z.object({
        title: z.string(),
        reason: z.string(),
        likelihood: z.enum(["likely", "possible"]),
        evidence: z.array(z.string()),
        change: ChangeSchema,
      }),
    ),
    rejected: z.array(z.object({ title: z.string(), reason: z.string() })),
    interest: z
      .object({ annualBps: z.number(), weeks: z.number(), netCents: z.number() })
      .nullable(),
    response: z
      .object({
        source: z.enum(["agents", "default"]),
        respondFrom: z.enum(["breach", "event"]),
        growthSpend: z.array(z.string()),
        spendCutPercent: z.number(),
        payrollCutPercent: z.number().optional(),
        likelihood: z.enum(["likely", "possible"]),
        reason: z.string(),
        evidence: z.array(z.string()),
        trigger: z.object({ date: z.string() }).passthrough().nullable(),
        notes: z.array(z.string()),
        applied: z.boolean(),
        skipped: z.string().nullable(),
      })
      .passthrough()
      .nullable()
      .optional(),
    context: z
      .array(z.object({ label: z.string(), relation: z.string(), sources: z.array(z.string()) }))
      .optional(),
    resultRunId: z.string().nullable(),
    warnings: z.array(z.string()),
    error: z.string().nullable(),
    createdAt: z.string(),
  })
  .passthrough();
export type Prediction = z.infer<typeof PredictionSchema>;

export const latestPredictionRef = makeFunctionReference<"query", PredictionKey, unknown>(
  "timeline/predict:latest",
);
export const startPredictionRef = makeFunctionReference<
  "mutation",
  StartPredictionArgs,
  { predictionId: string; created: boolean }
>("timeline/predict:start");
