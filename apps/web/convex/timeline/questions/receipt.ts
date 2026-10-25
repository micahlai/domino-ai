import {
  ChangeSchema,
  ConstraintSchema,
  OperationSummaryV1Schema,
  canonicalJson,
} from "@domino/contracts";
import { z } from "zod";

/** QuestionReceipt from kb/features/timeline/TL2-TL5-interface.md, strict. */
export const CitationSchema = z
  .object({ ref: z.string().min(1).max(200), label: z.string().min(1).max(200) })
  .strict();

export const QuestionProposalSchema = z
  .object({
    label: z.string().min(1).max(200),
    changes: z.array(ChangeSchema).max(16),
    constraints: z.array(ConstraintSchema).max(32).nullable(),
    constraintNote: z.string().max(500).nullable(),
  })
  .strict();

export const QuestionStatusSchema = z.enum([
  "running",
  "answered",
  "proposal",
  "clarification",
  "failed",
]);

export const QuestionReceiptSchema = z
  .object({
    id: z.string(),
    companyId: z.string(),
    runId: z.string(),
    requestId: z.string(),
    prompt: z.string().min(1).max(1_000),
    selectedWeek: z.string().nullable(),
    selectedItemId: z.string().nullable(),
    status: QuestionStatusSchema,
    answer: z.string().max(2_000),
    citations: z.array(CitationSchema).max(12),
    proposal: QuestionProposalSchema.nullable(),
    errorCode: z.string().max(64).nullable(),
    linkedRunId: z.string().nullable(),
    savedAt: z.string(),
    operation: OperationSummaryV1Schema,
  })
  .strict()
  .superRefine((r, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if ((r.status === "proposal") !== (r.proposal !== null))
      issue("only a proposal has a proposal");
    if ((r.status === "failed") !== (r.errorCode !== null))
      issue("only a failure has an error code");
    if (r.linkedRunId !== null && r.status !== "proposal") issue("only a proposal can be linked");
    const op = r.operation.status;
    const expected =
      r.status === "running" ? "running" : r.status === "failed" ? "failed" : "succeeded";
    if (op !== expected) issue("operation status does not match the receipt");
  });
export type QuestionReceipt = z.infer<typeof QuestionReceiptSchema>;
export type QuestionProposal = z.infer<typeof QuestionProposalSchema>;

/** Parse and require the value to be exactly the contract shape (no stripped fields). */
export function exactReceipt(value: unknown): QuestionReceipt | null {
  const parsed = QuestionReceiptSchema.safeParse(value);
  if (!parsed.success || canonicalJson(parsed.data) !== canonicalJson(value)) return null;
  return parsed.data;
}

/** Stored `data` column: the receipt plus private request-binding fields. */
export const RowDataSchema = z
  .object({
    receipt: z.unknown(),
    leaseUntil: z.number(),
    method: z.enum(["grammar", "provider"]),
    /** Rules of the asked run, so a proposal without rule edits links only to the same rules. */
    parentConstraints: z.array(ConstraintSchema),
  })
  .strict();
export type RowData = z.infer<typeof RowDataSchema>;
