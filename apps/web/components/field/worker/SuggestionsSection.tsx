"use client";

import { Check, Lightbulb, X } from "lucide-react";
import { useState } from "react";
import { cn } from "../../../lib/utils";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Skeleton } from "../../ui/skeleton";
import { day, money } from "./format";
import { DecidedDetails, EmptyCard, WorkerSection } from "./parts";
import {
  type EffectContext,
  type Suggestion,
  type SuggestionDecision,
  cashEffect,
  fixSentence,
  roomLine,
  scenarioTitle,
  splitSuggestions,
} from "./suggestions";

export type SuggestionsState =
  | { kind: "loading" }
  /** The suggestions backend is not deployed (or switched off) yet. */
  | { kind: "off" }
  | { kind: "error"; message: string }
  | { kind: "ready"; list: Suggestion[] };

export type DecideSuggestion = (
  suggestion: Suggestion,
  decision: SuggestionDecision,
  note: string,
) => Promise<void>;

export const NEVER_MOVES_MONEY = "Accepting records your decision. Domino never moves money.";

export function SuggestionsSection({
  state,
  context,
  onDecide,
}: {
  state: SuggestionsState;
  context: EffectContext;
  onDecide: DecideSuggestion;
}) {
  const { open, decided } =
    state.kind === "ready" ? splitSuggestions(state.list) : { open: [], decided: [] };
  return (
    <WorkerSection
      id="suggestions"
      step={1}
      title="Suggestions"
      count={state.kind === "ready" ? open.length : null}
      description="Fixes tested on your forecast by the engine. Accept or decline each one."
    >
      {state.kind === "loading" ? (
        <div className="space-y-3" aria-busy="true">
          <p className="sr-only">Loading suggestions</p>
          <Skeleton className="h-40 w-full" />
        </div>
      ) : state.kind === "off" ? (
        <EmptyCard icon={<Lightbulb />}>
          <p className="font-medium text-foreground">Suggestions are not switched on yet.</p>
          <p>
            Once suggestions are available, fixes tested for each risk appear here, with what they
            do to your lowest cash.
          </p>
        </EmptyCard>
      ) : state.kind === "error" ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/25 bg-destructive/[0.04] px-4 py-3 text-sm text-destructive"
        >
          Suggestions did not load: {state.message}
        </p>
      ) : open.length === 0 ? (
        <EmptyCard icon={<Lightbulb />}>
          <p className="font-medium text-foreground">No suggestions waiting.</p>
          <p>
            When a risk would take cash below the lender's minimum, the engine tests fixes and posts
            them here for you to accept or decline.
          </p>
        </EmptyCard>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card shadow-xs">
          {open.map((s) => (
            <SuggestionCard key={s.id} suggestion={s} context={context} onDecide={onDecide} />
          ))}
        </ul>
      )}
      {decided.length > 0 ? (
        <DecidedDetails count={decided.length} noun={["suggestion", "suggestions"]}>
          {decided.map((s) => (
            <li
              key={s.id}
              className="grid gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[96px_minmax(0,1fr)]"
            >
              <div>
                <Badge variant={s.status === "accepted" ? "success" : "secondary"}>
                  {s.status === "accepted" ? "Accepted" : "Declined"}
                </Badge>
              </div>
              <div className="min-w-0">
                <p className="leading-6">{fixSentence(s.fix)}</p>
                {s.note ? (
                  <p className="mt-0.5 text-[13px] text-muted-foreground">Note: {s.note}</p>
                ) : null}
              </div>
            </li>
          ))}
        </DecidedDetails>
      ) : null}
    </WorkerSection>
  );
}

const domId = (id: string) => `suggestion-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

function SuggestionCard({
  suggestion: s,
  context,
  onDecide,
}: { suggestion: Suggestion; context: EffectContext; onDecide: DecideSuggestion }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<SuggestionDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const effect = cashEffect(s, context);
  const scenario = scenarioTitle(s, context);
  const id = domId(s.id);
  async function decide(decision: SuggestionDecision) {
    setBusy(decision);
    setError(null);
    try {
      await onDecide(s, decision, note);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the decision.");
    } finally {
      // Saved cards move to Decided; this only matters if the card is still shown.
      setBusy(null);
    }
  }
  return (
    <li aria-labelledby={`${id}-title`} className="px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <p className="text-xs text-muted-foreground">
          Suggested by <span className="font-medium text-foreground">{s.by}</span>
        </p>
        <Badge variant={effect.stays ? "success" : "destructive"}>
          {effect.stays ? "Keeps you above the minimum" : "Still below the minimum"}
        </Badge>
      </div>
      <h3 id={`${id}-title`} className="mt-1 text-[15px] font-semibold leading-6">
        {fixSentence(s.fix)}
      </h3>
      {scenario ? (
        <p className="text-[13px] leading-5 text-muted-foreground">If: {scenario}</p>
      ) : null}

      <dl className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-md border bg-border text-[13px]">
        <EffectCell
          label={scenario ? "Lowest cash if it happens" : "Lowest cash now"}
          cents={effect.before?.cents ?? null}
          week={effect.before?.week ?? null}
          tone={
            effect.before && effect.minimum !== null && effect.before.cents < effect.minimum
              ? "bad"
              : null
          }
        />
        <EffectCell
          label="With this fix"
          cents={effect.after.cents}
          week={effect.after.week}
          tone={effect.stays ? "good" : "bad"}
          note={roomLine(effect)}
        />
        <EffectCell
          label="Lender's minimum"
          cents={effect.minimum}
          week={null}
          tone={null}
          missing="None set"
        />
      </dl>

      {s.recommendation ? (
        <p className="mt-3 text-[13px] leading-5 text-muted-foreground">
          <span className="font-medium text-foreground">Why: </span>
          {s.recommendation}
        </p>
      ) : null}

      <div className="mt-3 space-y-1.5">
        <label htmlFor={`${id}-note`} className="block text-[13px] font-medium">
          Note <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            id={`${id}-note`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="Why you decided this"
            className="h-11 sm:h-9 sm:flex-1"
          />
          <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex">
            <Button disabled={busy !== null} onClick={() => decide("accepted")}>
              <Check aria-hidden="true" />
              {busy === "accepted" ? "Saving..." : "Accept"}
            </Button>
            <Button variant="outline" disabled={busy !== null} onClick={() => decide("declined")}>
              <X aria-hidden="true" />
              {busy === "declined" ? "Saving..." : "Decline"}
            </Button>
          </div>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">{NEVER_MOVES_MONEY}</p>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function EffectCell({
  label,
  cents,
  week,
  tone,
  missing = "Unknown",
  note = null,
}: {
  label: string;
  cents: number | null;
  week: string | null;
  tone: "good" | "bad" | null;
  missing?: string;
  note?: string | null;
}) {
  const when = day(week);
  return (
    <div className="min-w-0 bg-card px-3 py-2">
      <dt className="text-xs leading-4 text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-1 text-[15px] font-semibold tabular-nums leading-5",
          tone === "good" && "text-safe",
          tone === "bad" && "text-destructive",
        )}
      >
        {cents === null ? missing : money(cents)}
      </dd>
      {when || note ? (
        <dd className="text-xs tabular-nums text-muted-foreground">
          {[when ? `Week of ${when}` : null, note].filter(Boolean).join(" · ")}
        </dd>
      ) : null}
    </div>
  );
}
