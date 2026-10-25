import { canonicalJson } from "@domino/contracts";
import { z } from "zod";
import {
  FieldTraceCandidateSchema,
  FieldTraceInputsSchema,
  FieldTraceScenarioSchema,
} from "./field-trace-contract";

const id = z.string().min(1).max(240);
/** Frozen evidence only. These fields are reference data, never instructions or approvals. */
export const WorkerSourceSchema = z
  .object({
    fieldCompanyId: id,
    runId: id,
    snapshotId: id,
    snapshotVersion: z.number().int().nonnegative().safe(),
    scenario: FieldTraceScenarioSchema,
    candidate: FieldTraceCandidateSchema,
    inputs: FieldTraceInputsSchema,
  })
  .strict();
/**
 * The context carries the pinned company model, which alone can pass 60 KB for a real company.
 * Keep it well under the 900 KB chat row cap so turns and proposals still fit beside it.
 */
const MAX_CONTEXT_BYTES = 400_000;
export const WorkerChatContextSchema = WorkerSourceSchema.extend({
  scenarioRunId: id,
  fixRunId: id,
  note: z.string().max(500),
})
  .strict()
  .superRefine((context, ctx) => {
    try {
      if (new TextEncoder().encode(canonicalJson(context)).length > MAX_CONTEXT_BYTES)
        ctx.addIssue({ code: "custom", message: "Worker context exceeds the saved context limit" });
    } catch {
      ctx.addIssue({ code: "custom", message: "Worker context is not valid saved data" });
    }
    if (
      context.candidate.scenarioId !== context.scenario.id ||
      context.inputs.company.id !== context.fieldCompanyId ||
      context.inputs.snapshot.id !== context.snapshotId ||
      context.inputs.snapshot.version !== context.snapshotVersion
    )
      ctx.addIssue({ code: "custom", message: "Worker source identity mismatch" });
  });
export type WorkerChatContext = z.infer<typeof WorkerChatContextSchema>;
