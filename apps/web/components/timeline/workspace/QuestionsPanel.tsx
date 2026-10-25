"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { formatExactCents, formatSavedAt } from "../baseline/format";
import { inputClass } from "./RuleEditor";
import { Panel, WhenDate } from "./RunPanels";
import type { QuestionReceipt, Read } from "./api";
import { changeText } from "./drafts";
import { type Outcome, isConfirmed } from "./requests";

export type AskInput = {
  prompt: string;
  selectedWeek: string | null;
  selectedItemId: string | null;
};
export type AskOutcome = { ok: true; receipt: QuestionReceipt } | { ok: false; message: string };
export type ProposalOutcome =
  | { ok: true; runId: string; linkError?: string }
  | { ok: false; message: string };

export type QuestionActions = {
  /** fresh: a new request after a definite failed answer; otherwise the same request is reused. */
  ask: (input: AskInput, fresh: boolean) => Promise<AskOutcome>;
  confirmProposal: (q: QuestionReceipt) => Promise<ProposalOutcome>;
  relink: (questionId: string, resultRunId: string) => Promise<Outcome>;
  hrefFor: (runId: string) => string;
};

const FAILURES: Record<string, string> = {
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

/** Merge the latest ask answer into the saved list until the list catches up. */
export function mergeReceipts(saved: QuestionReceipt[], latest: QuestionReceipt[]) {
  const ids = new Set(saved.map((q) => q.id));
  return [...saved, ...latest.filter((q) => !ids.has(q.id))];
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
        <p role="alert" className="text-sm text-[#E6A5B9]">
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

function Receipt({
  q,
  actions,
  onReask,
  onEdit,
}: {
  q: QuestionReceipt;
  actions: QuestionActions;
  onReask: (q: QuestionReceipt) => void;
  onEdit: (prompt: string) => void;
}) {
  return (
    <li className="space-y-2 border-t pt-3" data-testid={`question-${q.id}`} data-status={q.status}>
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
      {q.status === "running" ? (
        <output className="block text-sm text-muted-foreground" aria-busy="true">
          Reading the saved scenario...
        </output>
      ) : null}
      {q.status === "failed" ? (
        <div role="alert" className="space-y-1 text-sm">
          <p>{failureText(q.errorCode)}</p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onReask(q)}
            data-testid={`reask-${q.id}`}
          >
            Ask again
          </Button>
        </div>
      ) : null}
      {q.answer && q.status !== "failed" ? (
        <p className="whitespace-pre-wrap text-sm">{q.answer}</p>
      ) : null}
      {q.status === "clarification" ? (
        <Button size="sm" variant="secondary" onClick={() => onEdit(q.prompt)}>
          Add detail and ask again
        </Button>
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
    </li>
  );
}

export type QuestionsPanelProps = {
  questions: Read<QuestionReceipt[]>;
  selectedWeek: string | null;
  selectedItemId: string | null;
  onClearContext: () => void;
  actions: QuestionActions;
  disabled?: string;
};

/** One-shot questions about the saved scenario. Suggestions run only after confirmation. */
export function QuestionsPanel(p: QuestionsPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [latest, setLatest] = useState<QuestionReceipt[]>([]);

  async function send(input: AskInput, fresh: boolean) {
    if (pending || !input.prompt.trim()) return;
    setPending(true);
    setError(undefined);
    const out = await p.actions.ask({ ...input, prompt: input.prompt.trim() }, fresh);
    setPending(false);
    if (out.ok) {
      setLatest((ls) => [...ls.filter((q) => q.id !== out.receipt.id), out.receipt]);
      if (!fresh) setPrompt("");
    } else setError(out.message);
  }

  const saved = p.questions.state === "ready" ? p.questions.value : [];
  const all = mergeReceipts(saved, latest);

  return (
    <Panel title="Ask about this scenario" testId="questions">
      <p className="text-xs text-muted-foreground">
        For example: &ldquo;What if Acme pays 30 days late?&rdquo; or &ldquo;Keep at least
        $3,000,000 of usable cash.&rdquo; Answers come from the saved forecast. Suggested changes
        run only after you confirm them.
      </p>
      {p.selectedWeek || p.selectedItemId ? (
        <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="question-context">
          <span className="text-muted-foreground">Asking about</span>
          {p.selectedWeek ? (
            <Badge variant="outline">
              week of <WhenDate iso={p.selectedWeek} />
            </Badge>
          ) : null}
          {p.selectedItemId ? <Badge variant="outline">{p.selectedItemId}</Badge> : null}
          <Button size="sm" variant="ghost" onClick={p.onClearContext}>
            Clear
          </Button>
        </div>
      ) : null}
      <label className="block space-y-1 text-xs">
        <span>Your question</span>
        <textarea
          className={`${inputClass} h-20`}
          maxLength={2000}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          data-testid="question-prompt"
        />
      </label>
      <Button
        onClick={() =>
          send({ prompt, selectedWeek: p.selectedWeek, selectedItemId: p.selectedItemId }, false)
        }
        disabled={pending || !prompt.trim() || Boolean(p.disabled)}
        data-testid="question-ask"
      >
        {pending ? "Asking..." : "Ask"}
      </Button>
      {p.disabled ? <p className="text-xs text-muted-foreground">{p.disabled}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-[#E6A5B9]" data-testid="question-error">
          {error}
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
      {all.length ? (
        <ol className="space-y-3">
          {all.map((q) => (
            <Receipt
              key={q.id}
              q={q}
              actions={p.actions}
              onReask={(r) =>
                send(
                  {
                    prompt: r.prompt,
                    selectedWeek: r.selectedWeek,
                    selectedItemId: r.selectedItemId,
                  },
                  true,
                )
              }
              onEdit={setPrompt}
            />
          ))}
        </ol>
      ) : p.questions.state === "ready" ? (
        <p className="text-xs text-muted-foreground">No questions asked about this scenario yet.</p>
      ) : null}
    </Panel>
  );
}
