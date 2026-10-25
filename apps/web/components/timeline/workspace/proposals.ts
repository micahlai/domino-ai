import type { ProposalOutcome } from "./QuestionsPanel";
import {
  type QuestionReceipt,
  QuestionReceiptSchema,
  type ReviseArgs,
  type RunKey,
  type SimulateArgs,
} from "./api";
import type { Outcome, RequestLedger } from "./requests";

type ProposalWrites = {
  revise: (args: ReviseArgs) => Promise<Outcome>;
  simulate: (args: SimulateArgs) => Promise<Outcome>;
  relink: (questionId: string, resultRunId: string) => Promise<Outcome>;
};

/** Confirm one frozen suggestion, then tie that exact saved result to its question. */
export async function confirmQuestionProposal(
  q: QuestionReceipt,
  context: RunKey,
  ledger: RequestLedger,
  writes: ProposalWrites,
): Promise<ProposalOutcome> {
  const parsed = QuestionReceiptSchema.safeParse(q);
  if (
    !parsed.success ||
    q.companyId !== context.companyId ||
    q.runId !== context.runId ||
    q.status !== "proposal" ||
    !q.proposal
  )
    return { ok: false, message: "This answer has no usable suggestion for this scenario." };
  const p = parsed.data.proposal;
  if (!p || (!p.changes.length && p.constraints === null))
    return { ok: false, message: "This suggestion has no events or rules to save." };
  if (
    (p.constraints !== null && !p.constraintNote?.trim()) ||
    (p.constraints === null && p.constraintNote !== null)
  )
    return { ok: false, message: "This rule suggestion is missing its explanation. Ask again." };

  const constraintsJson = p.constraints === null ? undefined : JSON.stringify(p.constraints);
  let out: Outcome;
  if (!p.changes.length && constraintsJson !== undefined) {
    const note = p.constraintNote!;
    out = await writes.revise({
      companyId: context.companyId,
      parentRunId: q.runId,
      requestId: ledger.idFor(JSON.stringify(["rules", q.runId, constraintsJson, note])),
      constraintsJson,
      note,
      reviewed: true,
    });
  } else {
    const changesJson = JSON.stringify(p.changes);
    out = await writes.simulate({
      companyId: context.companyId,
      parentRunId: q.runId,
      requestId: ledger.idFor(
        JSON.stringify([
          "simulate",
          q.runId,
          p.label,
          changesJson,
          constraintsJson ?? null,
          p.constraintNote,
        ]),
      ),
      label: p.label,
      changesJson,
      reviewed: true,
      ...(constraintsJson !== undefined ? { constraintsJson } : {}),
      ...(p.constraintNote !== null ? { constraintNote: p.constraintNote } : {}),
    });
  }
  if (!out.ok) return out;
  const linked = await writes.relink(q.id, out.runId);
  return linked.ok ? out : { ...out, linkError: linked.message };
}
