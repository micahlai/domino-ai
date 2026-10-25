"use client";
import type { Constraint } from "@domino/contracts";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { formatExactCents, formatSavedAt } from "../baseline/format";
import { ReadNotice } from "../workspace/CatalogPanel";
import { inputClass } from "../workspace/RuleEditor";
import { WhenDate } from "../workspace/RunPanels";
import { type Read, type WorkspaceRun, workspaceHref } from "../workspace/api";
import { BranchNote } from "../workspace/branchPreview";
import { ChatScrollFrame, TypingDots, submitOnEnter, useEnter } from "../workspace/chatFrame";
import { changeText } from "../workspace/drafts";
import { WorkerContext } from "./WorkerContext";
import { type ChatReceipt, chatHref, displayedReceipt, newerReceipt } from "./api";
import {
  type OptimisticSend,
  bindMessage,
  messageAcknowledged,
  queuedMessage,
  visibleMessage,
} from "./optimistic";
import { type ChatCommand, type ChatOutcome, ChatWriteGuard } from "./requests";

export type ChatActions = {
  write: (command: ChatCommand) => Promise<ChatOutcome>;
  beginNavigates?: boolean;
};
export type ChatViewProps = {
  run: WorkspaceRun;
  selected: Read<ChatReceipt> | null;
  history: Read<ChatReceipt[]>;
  actions: ChatActions;
  selectedWeek?: string;
  selectedItemId?: string;
};
export function ReviewProposal({
  receipt,
  sourceRules,
}: { receipt: ChatReceipt; sourceRules: Constraint[] }) {
  const proposal = receipt.proposal;
  if (!proposal) return null;
  const rules = proposal.constraints ?? sourceRules;
  return (
    <div className="space-y-3 text-sm" data-testid="chat-review">
      <p className="font-medium">{proposal.label}</p>
      {proposal.changes.length ? (
        <div>
          <p className="text-muted-foreground">Events to add</p>
          <ul className="list-disc space-y-1 pl-5">
            {proposal.changes.map((change, i) => (
              <li key={`${change.kind}-${i}`}>{changeText(change, formatExactCents)}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p>No cash events will be added.</p>
      )}
      <div>
        <p className="text-muted-foreground">Rules for the new timeline</p>
        {proposal.constraints === null ? (
          <p className="text-xs text-muted-foreground">All source rules stay in place.</p>
        ) : null}
        <ul className="list-disc space-y-2 pl-5">
          {rules.map((rule) => (
            <li key={rule.id}>
              <span className="font-medium">{rule.label}</span>:{" "}
              {rule.kind === "min_cash"
                ? `at least ${formatExactCents(rule.limit)} usable cash`
                : rule.kind === "min_runway_months"
                  ? `at least ${rule.limit} months of runway`
                  : `bill ${rule.billId ?? "unspecified"}, at most ${rule.limit} days late`}
              <details className="mt-1 text-xs text-muted-foreground">
                <summary className="cursor-pointer">Show rule source</summary>
                <p>
                  {rule.evidence.source}: {rule.evidence.ref}
                </p>
                {rule.evidence.quote ? <p>{rule.evidence.quote}</p> : null}
                {rule.evidence.note ? <p>{rule.evidence.note}</p> : null}
                {rule.consequence ? (
                  <p>
                    Effect: {rule.consequence.label} ({rule.consequence.evidence.ref})
                  </p>
                ) : null}
              </details>
            </li>
          ))}
        </ul>
        {rules.length === 0 ? <p>No rules.</p> : null}
        {proposal.constraintNote ? (
          <p className="mt-2 text-muted-foreground">{proposal.constraintNote}</p>
        ) : null}
      </div>
    </div>
  );
}
type Choice = { label: string; value: string };
/** Claude's offered replies: buttons for a few, a dropdown for longer lists like invoices. */
function Choices({
  choices,
  disabled,
  onPick,
}: { choices: Choice[]; disabled: boolean; onPick: (value: string) => void }) {
  const [picked, setPicked] = useState("");
  const reduced = useReducedMotion();
  const enter = useEnter();
  if (choices.length <= 5)
    return (
      <div className="flex flex-wrap gap-2" data-testid="chat-choices">
        {choices.map((c, i) => (
          <motion.div
            key={c.value}
            {...enter}
            transition={reduced ? undefined : { ...enter.transition, delay: 0.05 * i }}
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => onPick(c.value)}
            >
              {c.label}
            </Button>
          </motion.div>
        ))}
      </div>
    );
  return (
    <motion.div {...enter} className="flex flex-wrap items-center gap-2" data-testid="chat-choices">
      <label className="sr-only" htmlFor="chat-choice">
        Choose an option
      </label>
      <select
        id="chat-choice"
        className={`${inputClass} min-w-0 flex-1`}
        value={picked}
        disabled={disabled}
        onChange={(e) => setPicked(e.target.value)}
      >
        <option value="">Choose an option…</option>
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
      <Button type="button" disabled={disabled || !picked} onClick={() => onPick(picked)}>
        Use this
      </Button>
    </motion.div>
  );
}
export function ChatView({
  run,
  selected,
  history,
  actions,
  selectedWeek,
  selectedItemId,
}: ChatViewProps) {
  const [writeGuard] = useState(() => new ChatWriteGuard());
  const blocked = writeGuard.pending !== null;
  const [latest, setLatest] = useState<ChatReceipt | null>(null);
  const [text, setText] = useState("");
  const [writing, setPending] = useState(false);
  const [optimistic, setOptimistic] = useState<OptimisticSend | null>(null);
  const optimisticRef = useRef<OptimisticSend | null>(null);
  const messageSequence = useRef(0);
  function updateOptimistic(message: OptimisticSend | null) {
    optimisticRef.current = message;
    setOptimistic(message);
  }
  const busy = useRef(false);
  const [error, setError] = useState<string>();
  const [reviewedFor, setReviewedFor] = useState<string | null>(null);
  const enter = useEnter();
  const queryReceipt = selected?.state === "ready" ? selected.value : null;
  // "Start new chat" leaves the conversation address: forget the old one's last reply.
  const named = selected !== null;
  const wasNamed = useRef(named);
  useEffect(() => {
    if (wasNamed.current && !named) {
      setLatest(null);
      optimisticRef.current = null;
      setOptimistic(null);
    }
    wasNamed.current = named;
  }, [named]);
  const opening = actions.beginNavigates === true && latest !== null && queryReceipt === null;
  const pending = writing || opening;
  const receipt = displayedReceipt(latest, queryReceipt, actions.beginNavigates === true);
  const token = receipt ? `${receipt.conversationId}:${receipt.revision}` : null;
  const reviewed = token !== null && reviewedFor === token;
  const turns = receipt?.turns.filter((turn) => turn.role === "user").length ?? 0;
  const lastTurn = receipt?.turns.at(-1);
  const optimisticTurn = visibleMessage(optimistic, receipt);
  async function write(command: ChatCommand): Promise<ChatOutcome | undefined> {
    if (busy.current || !writeGuard.allows(command)) return;
    busy.current = true;
    setPending(true);
    setError(undefined);
    let outcome: ChatOutcome | undefined;
    try {
      const result = await actions.write(command);
      outcome = result;
      if (result.ok) {
        writeGuard.resolve();
        setLatest((current) => newerReceipt(current, result.receipt));
        setReviewedFor(null);
        if (command.kind === "send") {
          const message = optimisticRef.current;
          if (message && messageAcknowledged(message, result.receipt)) updateOptimistic(null);
        }
        if (command.kind === "reset") {
          setText("");
          updateOptimistic(null);
        }
      } else {
        if (result.uncertain) writeGuard.remember(command);
        else writeGuard.resolve();
        const message = optimisticRef.current;
        if (message && (command.kind === "send" || command.kind === "begin")) {
          if (result.uncertain) updateOptimistic({ ...message, uncertain: true });
          else {
            if (!messageAcknowledged(message, queryReceipt)) setText(message.text);
            updateOptimistic(null);
          }
        }
        setError(result.message);
      }
    } catch {
      writeGuard.remember(command);
      if (optimisticRef.current) updateOptimistic({ ...optimisticRef.current, uncertain: true });
      setError(
        "The reply was not confirmed. Retry the same request or reopen the saved conversation.",
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
    return outcome;
  }
  /** Send a message; in the sidebar the first message also starts the conversation. */
  async function sendFirstMessage(command: Extract<ChatCommand, { kind: "begin" }>, value: string) {
    const begun = await write(command);
    if (begun?.ok) {
      if (optimisticRef.current)
        updateOptimistic(bindMessage(optimisticRef.current, begun.receipt));
      await write({ kind: "send", receipt: begun.receipt, text: value });
    }
  }
  async function sendText(value: string) {
    if (!value || turns >= 20 || busy.current || blocked || pending) return;
    updateOptimistic(queuedMessage(`optimistic-${++messageSequence.current}`, value, receipt));
    setText("");
    if (receipt) {
      await write({ kind: "send", receipt, text: value });
      return;
    }
    await sendFirstMessage(
      {
        kind: "begin",
        ...(selectedWeek ? { selectedWeek } : {}),
        ...(selectedItemId ? { selectedItemId } : {}),
      },
      value,
    );
  }
  function retryPending() {
    const command = writeGuard.pending;
    if (!command) return;
    if (optimisticRef.current) updateOptimistic({ ...optimisticRef.current, uncertain: false });
    if (command.kind === "begin" && optimisticRef.current)
      void sendFirstMessage(command, optimisticRef.current.text);
    else void write(command);
  }
  const firstWeek = run.forecast.weeks[0]?.weekStart ?? run.baseline.seed.asOf;

  const intro = (
    <p className="text-sm text-muted-foreground">
      Ask about the forecast, a week, a bill or the rules, or describe a what-if in plain words: a
      payment in or out, a late invoice, or a cash minimum, runway or bill deadline rule. I ask for
      anything missing.
    </p>
  );
  const start =
    !receipt && !selected && selectedWeek ? (
      <p className="text-xs text-muted-foreground">
        Asking about the week of <WhenDate iso={selectedWeek} />
        {selectedItemId ? ` · item ${selectedItemId}` : ""}.
      </p>
    ) : null;
  const notice =
    !receipt && selected && selected.state !== "ready" ? (
      <ReadNotice read={selected} what="conversation" />
    ) : null;
  const status = receipt ? (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge
          variant={
            receipt.status === "saved"
              ? "success"
              : receipt.status === "ready"
                ? "default"
                : receipt.pendingField
                  ? "warning"
                  : "outline"
          }
          data-testid="chat-status"
        >
          {pending
            ? "Thinking…"
            : receipt.status === "saved"
              ? "Saved as a scenario"
              : receipt.status === "ready"
                ? "Ready to review"
                : receipt.pendingField
                  ? "Needs one more detail"
                  : "Listening"}
        </Badge>
        <span className="text-xs text-muted-foreground">{turns} of 20 messages</span>
      </div>
      {receipt.selectedWeek ? (
        <p className="text-xs text-muted-foreground">
          Pinned week: <WhenDate iso={receipt.selectedWeek} />
          {receipt.selectedItemId ? ` · item ${receipt.selectedItemId}` : ""}.
        </p>
      ) : null}
    </>
  ) : null;
  const transcript =
    receipt || optimisticTurn ? (
      <ol
        aria-label="Conversation"
        aria-live="polite"
        aria-relevant="additions"
        className="space-y-4 py-3"
      >
        {receipt?.workerContext ? (
          <li>
            <WorkerContext context={receipt.workerContext} companyId={run.companyId} />
          </li>
        ) : null}
        <AnimatePresence initial={false}>
          {receipt?.turns.map((turn) => (
            <motion.li
              key={turn.id}
              {...enter}
              className={`max-w-[95%] origin-bottom rounded-lg px-4 py-3 text-sm ${turn.role === "user" ? "ml-auto origin-bottom-right bg-muted" : "mr-auto origin-bottom-left border"}`}
            >
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                {turn.role === "user" ? "You" : "Domino"}
              </p>
              <p className="whitespace-pre-wrap">{turn.text}</p>
              {turn.citations ? (
                <details className="mt-2 text-xs" data-testid="chat-citations">
                  <summary className="cursor-pointer text-muted-foreground">
                    Where this comes from ({turn.citations.length})
                  </summary>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {turn.citations.map((c) => (
                      <li key={c.ref}>
                        {c.label} <span className="font-mono text-muted-foreground">{c.ref}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </motion.li>
          ))}
          {optimisticTurn ? (
            <motion.li
              key={optimisticTurn.id}
              {...enter}
              className="ml-auto max-w-[95%] origin-bottom-right rounded-lg bg-muted px-4 py-3 text-sm"
              data-testid="chat-optimistic-message"
            >
              <p className="mb-1 text-xs font-medium text-muted-foreground">You</p>
              <p className="whitespace-pre-wrap">{optimisticTurn.text}</p>
              {optimisticTurn.uncertain ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Not confirmed yet. Retry this reply below.
                </p>
              ) : null}
            </motion.li>
          ) : null}
        </AnimatePresence>
      </ol>
    ) : null;
  const choices =
    receipt && receipt.status !== "saved" && lastTurn?.choices ? (
      <Choices
        key={lastTurn.id}
        choices={lastTurn.choices}
        disabled={pending || blocked || turns >= 20}
        onPick={(value) => void sendText(value)}
      />
    ) : null;
  // The composer is always offered: the first message starts the conversation.
  const canCompose = receipt ? receipt.status !== "saved" : !selected;
  const composer = canCompose ? (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim() && !pending && !blocked) void sendText(text.trim());
      }}
    >
      <label htmlFor="chat-reply" className="block text-sm font-medium">
        {receipt?.pendingField
          ? `Your reply · ${receipt.pendingField}`
          : receipt?.status === "ready"
            ? "Correct your draft or ask a question"
            : "Ask or describe a what-if"}
      </label>
      <textarea
        id="chat-reply"
        rows={2}
        maxLength={1000}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={submitOnEnter}
        disabled={pending || blocked || turns >= 20}
        className={`${inputClass} min-h-16 w-full resize-y`}
        placeholder={
          receipt?.pendingField
            ? "Type your answer…"
            : receipt?.status === "ready"
              ? "For example: change amount to $80,000"
              : `For example: Why is cash lowest in mid-November? or What if we pay $50,000 to Atlas Legal on ${firstWeek}?`
        }
        aria-describedby="chat-hint"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p id="chat-hint" className="text-xs text-muted-foreground">
          Short answers are welcome. Enter sends, Shift+Enter adds a line. {text.length}/1,000
        </p>
        <Button type="submit" disabled={pending || blocked || !text.trim() || turns >= 20}>
          {receipt ? "Send reply" : "Send"}
        </Button>
      </div>
      {turns >= 20 ? (
        <output className="block text-sm">
          This conversation has reached its 20-message limit. Start a new chat to continue.
        </output>
      ) : null}
    </form>
  ) : null;
  const review =
    receipt?.status === "ready" ? (
      <motion.div {...enter} className="space-y-4 rounded-lg border p-4">
        <h4 className="text-sm font-medium">Review before calculating</h4>
        <BranchNote changes={receipt.proposal?.changes ?? []} />
        <ReviewProposal receipt={receipt} sourceRules={run.constraints} />
        <p className="text-xs text-muted-foreground">
          These events apply to the source scenario. Saving calculates a new timeline and checks its
          rules.
        </p>
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <input
            className="mt-1 size-4 shrink-0 accent-primary"
            type="checkbox"
            checked={reviewed}
            disabled={pending || blocked}
            onChange={(e) => setReviewedFor(e.target.checked ? token : null)}
          />
          I reviewed these events, dates, amounts and the full rule set.
        </label>
        <Button
          disabled={!reviewed || pending || blocked}
          onClick={() => write({ kind: "confirm", receipt })}
        >
          Calculate and save scenario
        </Button>
        <p className="text-xs text-muted-foreground">
          To correct a detail, reply “change amount to $80,000” or “change date to 2026-11-17”. Use
          Start over for a different request. The transcript stays saved.
        </p>
      </motion.div>
    ) : null;
  const saved =
    receipt?.status === "saved" && receipt.linkedRunId ? (
      <motion.div {...enter} className="space-y-3 rounded-lg border border-safe/30 bg-safe/5 p-4">
        <p className="text-sm font-medium">Your scenario is saved.</p>
        <Link
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs hover:bg-primary/85 sm:min-h-9"
          href={workspaceHref(run.companyId, { runId: receipt.linkedRunId })}
          data-testid="chat-open-saved"
        >
          Open saved timeline
        </Link>
        <ReviewProposal receipt={receipt} sourceRules={run.constraints} />
      </motion.div>
    ) : null;
  const restart = receipt ? (
    <div className="flex flex-wrap gap-3">
      {receipt.status !== "saved" ? (
        <Button
          variant="outline"
          disabled={pending || blocked}
          onClick={() => write({ kind: "reset", receipt })}
        >
          Start over
        </Button>
      ) : null}
      <Link
        className="inline-flex min-h-11 items-center text-sm text-primary hover:underline"
        href={chatHref(run.companyId, run.runId)}
      >
        Start new chat
      </Link>
    </div>
  ) : null;
  const working = pending ? <TypingDots /> : null;
  const status2 = (
    <>
      {opening && latest ? (
        <Link
          className="block text-sm text-primary hover:underline"
          href={chatHref(
            run.companyId,
            run.runId,
            latest.conversationId,
            latest.selectedWeek ?? undefined,
            latest.selectedItemId ?? undefined,
          )}
        >
          Open the saved conversation
        </Link>
      ) : null}
      {blocked ? (
        <div className="space-y-2 rounded-lg border p-3 text-sm">
          <p>
            A reply is still unconfirmed. Retry that exact reply before sending another, or reload
            this conversation to read its saved state.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={pending} onClick={retryPending}>
              Retry unconfirmed reply
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => window.location.reload()}>
              Reload saved conversation
            </Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
  const recent = (
    <details className="min-w-0 rounded-lg border p-4">
      <summary className="cursor-pointer text-sm font-medium">Recent conversations</summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-muted-foreground">
          Up to 20 saved conversations for this source timeline. Reopening only reads saved data.
        </p>
        {history.state !== "ready" ? (
          <ReadNotice read={history} what="conversation list" />
        ) : history.value.length === 0 ? (
          <p className="text-sm text-muted-foreground">No conversations yet.</p>
        ) : (
          <ul className="space-y-3">
            {history.value.map((r) => (
              <li key={r.conversationId} className="space-y-1 border-t pt-3 text-sm">
                <Link
                  aria-current={r.conversationId === receipt?.conversationId ? "page" : undefined}
                  className="block min-h-11 text-primary hover:underline"
                  href={chatHref(
                    run.companyId,
                    run.runId,
                    r.conversationId,
                    r.selectedWeek ?? undefined,
                    r.selectedItemId ?? undefined,
                  )}
                >
                  {r.proposal?.label ||
                    r.turns.find((t) => t.role === "user")?.text ||
                    "New conversation"}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {r.status === "saved"
                    ? "Saved"
                    : r.status === "ready"
                      ? "Ready to review"
                      : "In progress"}{" "}
                  · {formatSavedAt(r.updatedAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );

  return (
    <article
      className="flex h-full min-h-0 min-w-0 max-w-full flex-col [overflow-wrap:anywhere]"
      data-testid="timeline-chat"
    >
      <ChatScrollFrame
        label="What-if conversation"
        followKey={`${lastTurn?.id ?? ""}:${optimisticTurn?.id ?? ""}:${pending}:${receipt?.status ?? ""}`}
        composer={composer}
      >
        <h3 className="text-[15px] font-semibold tracking-[-0.01em]">Ask Domino</h3>
        {intro}
        {notice}
        {start}
        {status}
        {transcript}
        {working}
        {choices}
        {review}
        {saved}
        {restart}
        {status2}
        {recent}
      </ChatScrollFrame>
    </article>
  );
}
