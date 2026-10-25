"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { formatExactCents, formatSavedAt } from "../baseline/format";
import { WhenDate } from "./RunPanels";
import type { QuestionReceipt, Read } from "./api";
import { BranchNote } from "./branchPreview";
import { ChatScrollFrame, useEnter } from "./chatFrame";
import { changeText } from "./drafts";
import { type Outcome, isConfirmed } from "./requests";

export type ProposalOutcome =
  | { ok: true; runId: string; linkError?: string }
  | { ok: false; message: string };

export type QuestionActions = {
  confirmProposal: (q: QuestionReceipt) => Promise<ProposalOutcome>;
  relink: (questionId: string, resultRunId: string) => Promise<Outcome>;
  hrefFor: (runId: string) => string;
};

const FAILURES: Record<string, string> = {
  PROVIDER_UNAVAILABLE:
    'I could not read that. Try something like "Why did cash drop this week?" Nothing was calculated.',
  PROVIDER_TIMEOUT:
    "The language reader took too long. Nothing was calculated. Ask again to retry.",
  PROVIDER_ERROR:
    "The language reader could not be reached. Nothing was calculated. Ask again to retry.",
  PROVIDER_REFUSED: "The language reader declined this question. Nothing was calculated.",
  PROVIDER_TRUNCATED:
    "The language reader’s reply was cut off. Nothing was calculated. Ask again to retry.",
  PROVIDER_MALFORMED:
    "The language reader’s reply was not usable, so it was discarded. Nothing was calculated.",
  LEASE_EXPIRED:
    "This question stopped before it finished. Nothing was calculated. Ask again to retry.",
  INTERNAL: "This question could not be finished. Nothing was calculated. Ask again to retry.",
  no_provider:
    "No question service is set up here, so the question was not answered. Nothing was calculated.",
  timeout: "The question took too long and was stopped. Nothing was calculated.",
  refused: "The question service declined to answer. Nothing was calculated.",
  invalid_output: "The answer was not in a usable shape, so it was thrown away.",
  abandoned: "The question stopped before finishing. Nothing was calculated.",
};

function failureText(code: string | null): string {
  if (code && FAILURES[code]) return FAILURES[code];
  return `The question could not be answered${code ? ` (${code})` : ""}. Nothing was calculated.`;
}

function ProposalCard({ q, actions }: { q: QuestionReceipt; actions: QuestionActions }) {
  const proposal = q.proposal;
  const payload = proposal ? `${q.id}:${JSON.stringify(proposal)}` : null;
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<{ runId: string; linkError?: string }>();
  if (!proposal) return null;
  const confirmed = isConfirmed(confirmedFor, payload);
  const linkedRunId = q.linkedRunId ?? (result && !result.linkError ? result.runId : null);

  async function run() {
    if (!confirmed || pending) return;
    setPending(true);
    setError(undefined);
    const out = await actions.confirmProposal(q);
    setPending(false);
    if (out.ok) setResult({ runId: out.runId, linkError: out.linkError });
    else setError(out.message);
  }

  async function relink() {
    if (!result || pending) return;
    setPending(true);
    const out = await actions.relink(q.id, result.runId);
    setPending(false);
    setResult(out.ok ? { runId: result.runId } : { runId: result.runId, linkError: out.message });
  }

  return (
    <div className="space-y-2 rounded-md border p-3" data-testid={`proposal-${q.id}`}>
      <p className="text-sm font-medium">Suggested scenario: {proposal.label}</p>
      {linkedRunId ? null : <BranchNote changes={proposal.changes} />}
      {proposal.changes.length ? (
        <ul className="list-disc space-y-0.5 pl-5 text-sm">
          {proposal.changes.map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: proposal order is fixed
            <li key={i}>{changeText(c, formatExactCents)}</li>
          ))}
        </ul>
      ) : null}
      {proposal.constraints ? (
        <div className="text-sm">
          <p>Replace the cash rules with:</p>
          <ul className="list-disc pl-5">
            {proposal.constraints.map((c) => (
              <li key={c.id}>
                {c.label} (
                {c.kind === "min_cash"
                  ? `at least ${formatExactCents(c.limit)}`
                  : c.kind === "min_runway_months"
                    ? `at least ${c.limit} months`
                    : `bill ${c.billId ?? "?"} at most ${c.limit} days late`}
                )
              </li>
            ))}
            {proposal.constraints.length === 0 ? <li>No rules</li> : null}
          </ul>
          {proposal.constraintNote ? (
            <p className="text-xs text-muted-foreground">Note: {proposal.constraintNote}</p>
          ) : null}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Nothing has been calculated yet. The forecast runs only after you confirm.
      </p>
      {linkedRunId ? (
        <p className="text-sm" data-testid="proposal-linked">
          Saved as a scenario.{" "}
          <Link
            className="text-primary underline-offset-4 hover:underline"
            href={actions.hrefFor(linkedRunId)}
          >
            Open it
          </Link>
        </p>
      ) : result?.linkError ? (
        <div role="alert" className="space-y-1 text-sm" data-testid="proposal-link-failed">
          <p>
            The scenario was saved, but it could not be tied back to this question.{" "}
            <Link
              className="text-primary underline-offset-4 hover:underline"
              href={actions.hrefFor(result.runId)}
            >
              Open the scenario
            </Link>
          </p>
          <Button size="sm" variant="secondary" onClick={relink} disabled={pending}>
            Tie it to the question again
          </Button>
        </div>
      ) : (
        <>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={confirmed}
              onChange={(e) => setConfirmedFor(e.target.checked ? payload : null)}
              data-testid={`proposal-confirm-${q.id}`}
            />
            <span>I reviewed this suggestion. Run it as a new scenario.</span>
          </label>
          <Button size="sm" onClick={run} disabled={!confirmed || pending}>
            {pending ? "Running..." : "Run this scenario"}
          </Button>
        </>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const STATUS_TEXT: Record<QuestionReceipt["status"], string> = {
  running: "Working on it",
  answered: "Answered",
  proposal: "Suggestion",
  clarification: "Needs more detail",
  failed: "Not answered",
};

function Receipt({ q, actions }: { q: QuestionReceipt; actions: QuestionActions }) {
  const enter = useEnter();
  return (
    <motion.li
      {...enter}
      className="space-y-2 border-t pt-3"
      data-testid={`question-${q.id}`}
      data-status={q.status}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">{STATUS_TEXT[q.status]}</Badge>
        <span>{formatSavedAt(q.savedAt)}</span>
        {q.selectedWeek ? (
          <span>
            about the week of <WhenDate iso={q.selectedWeek} />
          </span>
        ) : null}
        {q.selectedItemId ? <span>item {q.selectedItemId}</span> : null}
      </div>
      <p className="text-sm font-medium">{q.prompt}</p>
      <details className="text-xs" data-testid={`question-method-${q.id}`}>
        <summary className="cursor-pointer text-muted-foreground">How this was read</summary>
        <p className="mt-1">{q.operation.title}</p>
      </details>
      {q.status === "running" ? (
        <output className="block text-sm text-muted-foreground" aria-busy="true">
          Reading the saved scenario...
        </output>
      ) : null}
      {q.status === "failed" ? (
        <p role="alert" className="text-sm">
          {failureText(q.errorCode)}
        </p>
      ) : null}
      {q.answer && q.status !== "failed" ? (
        <p className="whitespace-pre-wrap text-sm">{q.answer}</p>
      ) : null}
      {q.citations.length ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Where this comes from ({q.citations.length})
          </summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {q.citations.map((c) => (
              <li key={c.ref}>
                {c.label} <span className="font-mono text-muted-foreground">{c.ref}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {q.status === "proposal" ? <ProposalCard q={q} actions={actions} /> : null}
    </motion.li>
  );
}

export type QuestionsPanelProps = {
  questions: Read<QuestionReceipt[]>;
  actions: QuestionActions;
};

/**
 * Earlier one-off questions about the saved scenario, behind the Ask Domino chat. New questions
 * go to the chat; saved suggestions stay confirmable and run only after confirmation.
 */
export function QuestionsPanel(p: QuestionsPanelProps) {
  const all = p.questions.state === "ready" ? p.questions.value : [];
  return (
    <section
      className="flex h-full min-h-0 min-w-0 max-w-full flex-col [overflow-wrap:anywhere] [&_button]:h-auto [&_button]:min-h-8 [&_button]:max-w-full [&_button]:whitespace-normal max-sm:[&_button]:min-h-11"
      data-testid="questions"
    >
      <ChatScrollFrame
        label="Questions and answers"
        followKey={`${all.length}:${all.at(-1)?.status ?? ""}`}
      >
        <h3 className="text-[15px] font-semibold tracking-[-0.01em]">Earlier questions</h3>
        <p className="text-sm text-muted-foreground">
          One-off questions asked before the chat could answer them. Ask new questions in the chat.
        </p>
        {all.length ? (
          <ol className="space-y-3">
            <AnimatePresence initial={false}>
              {all.map((q) => (
                <Receipt key={q.id} q={q} actions={p.actions} />
              ))}
            </AnimatePresence>
          </ol>
        ) : p.questions.state === "ready" ? (
          <p className="text-xs text-muted-foreground">
            No questions asked about this scenario yet.
          </p>
        ) : null}
        {p.questions.state === "loading" ? (
          <output className="block text-xs text-muted-foreground">
            Reading earlier questions...
          </output>
        ) : p.questions.state !== "ready" ? (
          <p role="alert" className="text-xs text-muted-foreground">
            Earlier questions could not be shown.
          </p>
        ) : null}
      </ChatScrollFrame>
    </section>
  );
}
