"use client";

import { useConvexConnectionState, useMutation, useQueries } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { api } from "../../convex/_generated/api";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { HistoricalReplay } from "./HistoricalReplay";
import {
  type AlternativeData,
  AlternativeDataSchema,
  BaselineDataSchema,
  CASE_ID,
  CaseDataSchema,
  RevealDataSchema,
  alternativeIssue,
  buildView,
  mayApplyCompletion,
} from "./live";

const codeText: Record<string, string> = {
  NOT_FOUND: "That saved item was not found. Check the link, or start again from the cutoff.",
  INTEGRITY:
    "The stored record failed its integrity check, so it is not shown. Start again from the cutoff.",
  CASE_CHANGED:
    "The case changed since this forecast was saved. Save a new forecast to compute an alternative; the old one stays as it was.",
  CONFLICT: "That request was already used for something else. Reload the page and try again.",
  INVALID_BRANCH: "That step does not apply to this run.",
  NOTHING_TO_REVEAL: "There is no later publication in this case to reveal.",
  INVALID_REQUEST: "The request was not valid. Reload the page and try again.",
};
const ErrorData = z.object({ code: z.string() });

/** A call succeeded but its answer was unusable. The request itself may have been recorded. */
class UnusableResult extends Error {}

/** Plain words for a failed call. A lost response may still have been applied, so never say it was not. */
export function describeError(error: unknown): string {
  if (error instanceof UnusableResult)
    return "The service answered, but the answer could not be used. The request may have been recorded.";
  if (error instanceof ConvexError) {
    const data = ErrorData.safeParse(error.data);
    const text = data.success ? codeText[data.data.code] : undefined;
    if (text) return text;
  }
  return "Could not confirm the result. The request may or may not have been recorded. Check the connection and try again: the retry uses the same request, so it will not be saved twice.";
}

export type Act = { pending?: boolean; error?: string; done?: boolean };
export type Acts = Partial<Record<string, Act>>;

interface Raw {
  case?: unknown;
  run?: unknown;
  reveal?: unknown;
  alt?: unknown;
}

function Problem({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div role="alert" className="rounded-lg border p-5 text-sm">
      <p className="font-medium">{title}</p>
      <div className="mt-1 space-y-2 text-muted-foreground">{children}</div>
    </div>
  );
}

const restart = (
  <Link href="/historical" className="inline-block min-h-6 text-primary underline">
    Start again from the cutoff
  </Link>
);

function Step({
  title,
  body,
  button,
  act,
  onClick,
}: { title: string; body: string; button: string; act?: Act; onClick: () => void }) {
  return (
    <Card className="shadow-none">
      <CardContent className="space-y-3 p-5">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm leading-6 text-muted-foreground">{body}</p>
        {act?.error ? (
          <p role="alert" className="text-sm text-destructive">
            {act.error} Your request is kept, so trying again will not duplicate it.
          </p>
        ) : null}
        {act?.done ? (
          <output className="block text-sm text-muted-foreground">Done. Updating the page…</output>
        ) : (
          <Button onClick={onClick} disabled={act?.pending}>
            {act?.pending ? "Working…" : act?.error ? `Try again: ${button}` : button}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/** Everything the user sees, from already-fetched results. No hooks, so it renders in tests. */
export function HistoricalJourney({
  runId,
  altId,
  raw,
  acts,
  onSave,
  onReveal,
  onAlternative,
}: {
  runId?: string;
  altId?: string;
  raw: Raw;
  acts: Acts;
  onSave: () => void;
  onReveal: () => void;
  onAlternative: () => void;
}) {
  const failed = [raw.case, runId ? raw.run : undefined, runId ? raw.reveal : undefined].find(
    (r): r is Error => r instanceof Error,
  );
  if (failed)
    return (
      <Problem title="Could not load this case.">
        <p>{describeError(failed)}</p>
        {restart}
      </Problem>
    );
  if (raw.case === undefined || (runId && (raw.run === undefined || raw.reveal === undefined)))
    return <HistoricalReplay status="loading" />;
  const caseData = CaseDataSchema.safeParse(raw.case);
  const baseline = runId ? BaselineDataSchema.safeParse(raw.run) : undefined;
  const reveal = runId ? RevealDataSchema.safeParse(raw.reveal) : undefined;
  if (!caseData.success || (baseline && !baseline.success) || (reveal && !reveal.success))
    return (
      <Problem title="The saved data was not in the expected shape.">
        <p>Nothing is shown rather than guessing. Nothing was changed.</p>
        {restart}
      </Problem>
    );
  if (baseline?.success && baseline.data.run.id !== runId)
    return (
      <Problem title="That run does not match the link.">
        <p>Nothing is shown rather than guessing.</p>
        {restart}
      </Problem>
    );
  const base = baseline?.success ? baseline.data : undefined;
  const revealData = reveal?.success ? reveal.data : null;
  // Both the frozen case view and the reveal record must agree before anything later shows.
  if (base && Boolean(revealData) !== caseData.data.revealed)
    return <HistoricalReplay status="loading" />;

  let altNote: string | undefined;
  let alternative: AlternativeData | undefined;
  if (altId && !base)
    altNote =
      "An alternative can only be shown under the baseline it belongs to. Add that baseline's run id too.";
  else if (altId && base) {
    if (raw.alt instanceof Error)
      altNote = `The alternative could not be loaded. ${describeError(raw.alt)}`;
    else if (raw.alt === undefined) altNote = "Loading the alternative…";
    else {
      const parsed = AlternativeDataSchema.safeParse(raw.alt);
      if (!parsed.success)
        altNote = "The alternative was not in the expected shape, so it is not shown.";
      else {
        // The link is untrusted: show it only under the baseline it was computed from.
        const issue = alternativeIssue(base, parsed.data);
        if (issue) altNote = issue.message;
        else if (parsed.data.run.id !== altId)
          altNote = "That alternative does not match the link, so it is not shown.";
        else if (!revealData) altNote = "An alternative is only shown after the reveal.";
        else alternative = parsed.data;
      }
    }
  }
  const view = buildView({
    caseData: caseData.data,
    baseline: base,
    reveal: revealData,
    alternative,
  });
  return (
    <div className="space-y-6">
      {altNote ? (
        <p role="alert" className="rounded-lg border p-4 text-sm">
          {altNote}
        </p>
      ) : null}
      {!base ? (
        <Step
          title="Step 1. Save the forecast"
          body="Domino will compute one forecast from the evidence listed below, which was public by the knowledge cutoff, and save it. Nothing published later is read."
          button="Save forecast"
          act={acts.save}
          onClick={onSave}
        />
      ) : !revealData ? (
        <Step
          title="Step 2. Reveal what was reported"
          body="This shows the next report published after the cutoff and compares it with the saved forecast. The forecast does not change, and a miss stays visible. Later evidence stays hidden until you do this."
          button="Reveal what was reported"
          act={acts.reveal}
          onClick={onReveal}
        />
      ) : !alternative ? (
        <Step
          title="Step 3. Compute one alternative, cost only"
          body="Domino computes the cost of one hypothetical second cost action (A1) from the same cutoff evidence. It is chosen with the outcome known, shows cost only, and is not compared with what was reported."
          button="Compute the alternative"
          act={acts.alt}
          onClick={onAlternative}
        />
      ) : null}
      {base ? (
        <p className="break-all text-xs text-muted-foreground">
          Reload keeps your place. The page address holds run {base.run.id}
          {alternative ? ` and alternative ${alternative.run.id}` : ""}.
        </p>
      ) : null}
      <HistoricalReplay view={view} />
    </div>
  );
}

function ConnectionNotice() {
  const connection = useConvexConnectionState();
  if (connection.isWebSocketConnected || !connection.connectionRetries) return null;
  return (
    <output className="block rounded-lg bg-secondary p-4 text-sm text-muted-foreground">
      {connection.hasEverConnected
        ? "Reconnecting to the history service. What you see may be out of date."
        : "Could not connect to the history service yet. Retrying automatically…"}
    </output>
  );
}

/** Random, URL-safe, 8-64 chars, as the backend requires. Reused on retry, never regenerated. */
function newRequestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const SavedRun = z.object({ runId: z.string().min(1) });

/** Throws, so perform shows a retryable error with the same request id. */
function savedRunId(result: unknown) {
  const saved = SavedRun.safeParse(result);
  if (!saved.success) throw new UnusableResult();
  return saved.data.runId;
}

/** The map must keep its identity between renders: useQueries resubscribes on a new one. */
export function useHistoricalQueries(runId?: string, altId?: string) {
  return useMemo(
    () => ({
      case: {
        query: api.historical.getCase,
        args: { caseId: CASE_ID, ...(runId ? { runId } : {}) },
      },
      ...(runId
        ? {
            run: { query: api.historical.getRun, args: { caseId: CASE_ID, runId } },
            reveal: { query: api.historical.getReveal, args: { runId } },
          }
        : {}),
      ...(runId && altId
        ? { alt: { query: api.historical.getRun, args: { caseId: CASE_ID, runId: altId } } }
        : {}),
    }),
    [runId, altId],
  );
}

function Connected() {
  const params = useSearchParams();
  const runId = params.get("run") || undefined;
  // A different run is a different session: action state and request ids start clean.
  return <Session key={runId ?? "new"} runId={runId} altId={params.get("alt") || undefined} />;
}

function Session({ runId, altId }: { runId?: string; altId?: string }) {
  const router = useRouter();
  const raw = useQueries(useHistoricalQueries(runId, altId));
  const saveBaseline = useMutation(api.historical.saveBaseline);
  const reveal = useMutation(api.historical.reveal);
  const computeAlternative = useMutation(api.historical.computeAlternative);
  const [acts, setActs] = useState<Acts>({});
  // One request id per user intent, kept until success so a retry cannot save twice.
  const requestIds = useRef<Record<string, string>>({});
  const inFlight = useRef(new Set<string>());

  // A replaced or unmounted session must not navigate or update state when its call finishes.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // alive only flips in effect cleanup, after the address may already have changed, so also
  // compare the live address with the one this session started from.
  const stillHere = () =>
    mayApplyCompletion({
      alive: alive.current,
      pathname: window.location.pathname,
      search: window.location.search,
      originRunId: runId,
    });

  // Read the live address, not the one captured when the call started, so a style chosen
  // while the call was in flight is kept.
  function setParam(name: string, value: string) {
    const next = new URLSearchParams(window.location.search);
    next.set(name, value);
    router.replace(`${window.location.pathname}?${next.toString()}`, { scroll: false });
  }

  async function perform(
    key: string,
    call: (requestId: string) => Promise<string>,
    after?: (runId: string) => void,
  ) {
    if (inFlight.current.has(key) || acts[key]?.done) return;
    inFlight.current.add(key);
    requestIds.current[key] ??= newRequestId();
    setActs((a) => ({ ...a, [key]: { pending: true } }));
    try {
      const result = await call(requestIds.current[key]);
      if (!stillHere()) return;
      setActs((a) => ({ ...a, [key]: { done: true } }));
      after?.(result);
    } catch (error) {
      if (stillHere()) setActs((a) => ({ ...a, [key]: { error: describeError(error) } }));
    } finally {
      inFlight.current.delete(key);
    }
  }

  const named = (name: string) => (runId ? `${name}:${runId}` : name);
  return (
    <div className="space-y-4">
      <ConnectionNotice />
      <HistoricalJourney
        runId={runId}
        altId={altId}
        raw={raw}
        acts={{
          save: acts.save,
          reveal: acts[named("reveal")],
          alt: acts[named("alt")],
        }}
        onSave={() =>
          perform(
            "save",
            async (requestId) => savedRunId(await saveBaseline({ requestId, caseId: CASE_ID })),
            (id) => setParam("run", id),
          )
        }
        onReveal={() =>
          runId &&
          perform(named("reveal"), (requestId) => reveal({ requestId, runId }).then(() => ""))
        }
        onAlternative={() =>
          runId &&
          perform(
            named("alt"),
            async (requestId) =>
              savedRunId(await computeAlternative({ requestId, baselineRunId: runId })),
            (id) => setParam("alt", id),
          )
        }
      />
    </div>
  );
}

export function HistoricalLive() {
  // Missing deployment stays honestly unavailable; sample data never stands in for real history.
  if (!process.env.NEXT_PUBLIC_CONVEX_URL)
    return (
      <div className="space-y-3">
        <HistoricalReplay
          status="unavailable"
          statusMessage="This environment is not connected to the history service, so no case is loaded and nothing can be saved. No sample data is shown in its place."
        />
        <Link href="/playground" className="inline-block min-h-6 text-sm text-primary underline">
          See the synthetic layout preview (not real history)
        </Link>
      </div>
    );
  return <Connected />;
}
