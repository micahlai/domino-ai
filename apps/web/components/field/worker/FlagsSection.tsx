"use client";

import { Check, ChevronRight, ClipboardCheck, Link2, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { cn } from "../../../lib/utils";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Skeleton } from "../../ui/skeleton";
import { mapNodeHref, recordSourceNode } from "../cross-links";
import { useFieldData } from "../data";
import { LARGE_CENTS, describeFinding, findingExplanation, relatedFlags } from "../finding-text";
import { FINDING_LABEL, SEVERITY_BADGE, SEVERITY_LABEL, timeAgo } from "../parts";
import type { Decision, FieldFinding } from "../types";
import { DecidedDetails, EmptyCard, WorkerSection, linkClass } from "./parts";

// "Flags to review": the audit agent's flag queue. Confirm a flag if it is a real problem,
// dismiss it if it is fine. Claude's plain explanation shows under each flag when it exists.

export function FlagsSection({
  findings,
  now,
}: { findings: FieldFinding[] | undefined; now: number }) {
  const open = findings?.filter((f) => f.status === "open") ?? [];
  const decided = findings?.filter((f) => f.status !== "open") ?? [];
  const related = relatedFlags(open);
  return (
    <WorkerSection
      id="flags"
      step={3}
      title="Flags to review"
      count={findings ? open.length : null}
      description="Odd entries the audit agent found in your tools. Confirm a real problem, dismiss the rest."
    >
      {!findings ? (
        <div className="space-y-3" aria-busy="true">
          <p className="sr-only">Loading flags</p>
          <Skeleton className="h-24 w-full" />
        </div>
      ) : open.length === 0 ? (
        <EmptyCard icon={<ClipboardCheck />}>
          <p className="font-medium text-foreground">No flags to review.</p>
          <p>
            When the audit agent spots something odd in new entries, such as a duplicate bill or a
            missing payroll run, it appears here.
          </p>
        </EmptyCard>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card shadow-xs">
          <AnimatePresence initial={false}>
            {open.map((finding) => (
              <FindingCard
                key={finding.id}
                finding={finding}
                now={now}
                related={(related.get(finding.id) ?? []).flatMap((id) => {
                  const other = open.find((f) => f.id === id);
                  return other ? [other] : [];
                })}
              />
            ))}
          </AnimatePresence>
        </ul>
      )}
      {decided.length > 0 ? (
        <DecidedDetails count={decided.length} noun={["flag", "flags"]}>
          {decided.map((f) => {
            const view = describeFinding(f);
            return (
              <li
                key={f.id}
                className="grid gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[96px_minmax(0,1fr)]"
              >
                <div>
                  <Badge variant={f.status === "approved" ? "success" : "secondary"}>
                    {f.status === "approved" ? "Confirmed" : "Dismissed"}
                  </Badge>
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">
                    {view.counterparty
                      ? `${view.counterparty} · ${FINDING_LABEL[f.kind]}`
                      : FINDING_LABEL[f.kind]}
                  </p>
                  <p className="mt-0.5 leading-6">{view.headline}</p>
                  {f.note ? (
                    <p className="mt-1 text-[13px] text-muted-foreground">Note: {f.note}</p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </DecidedDetails>
      ) : null}
    </WorkerSection>
  );
}

/** A DOM id for a flag; finding ids can carry ":" and ",". */
const flagDomId = (id: string) => `flag-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
/** The primary amount sits next to the name, so the fact line skips it. */
const PRIMARY_FACT = new Set(["Amount", "Now"]);

function FindingCard({
  finding,
  now,
  related,
}: { finding: FieldFinding; now: number; related: FieldFinding[] }) {
  const { actions, decideError } = useFieldData();
  const reduced = useReducedMotion();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const view = describeFinding(finding);
  const { explanation, suggestedCheck } = findingExplanation(finding);
  const primary = view.facts.find((f) => PRIMARY_FACT.has(f.label));
  const rest = view.facts.filter((f) => f !== primary);
  const high = finding.severity === "high";
  const large = view.amountCents !== null && Math.abs(view.amountCents) >= LARGE_CENTS;
  async function decide(decision: Decision) {
    setBusy(decision);
    setError(null);
    try {
      await actions.decide({ findingId: finding.id, decision, note: note.trim() });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the decision.");
      setBusy(null);
    }
  }
  const shownError = error ?? (decideError?.findingId === finding.id ? decideError.message : null);
  const recordNode = finding.refs.map(recordSourceNode).find((n) => n !== null) ?? null;
  const noteId = `note-${finding.id}`;
  const domId = flagDomId(finding.id);
  return (
    <motion.li
      id={domId}
      layout={!reduced}
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      aria-labelledby={`${domId}-title`}
      className={cn(
        "relative scroll-mt-20 bg-card px-4 py-3.5",
        high &&
          "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-destructive",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`${domId}-title`} className="text-[15px] font-semibold leading-6">
            {view.counterparty ?? FINDING_LABEL[finding.kind]}
          </h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <Badge variant={SEVERITY_BADGE[finding.severity]}>
              {SEVERITY_LABEL[finding.severity]}
            </Badge>
            {view.counterparty ? <span>{FINDING_LABEL[finding.kind]}</span> : null}
            <span>Found {timeAgo(finding.detectedAt, now)}</span>
            {finding.escalated ? <span>Escalated to you</span> : null}
          </div>
        </div>
        {primary ? (
          <p className="shrink-0 text-right">
            <span
              className={cn(
                "block font-semibold tabular-nums tracking-[-0.01em]",
                high || large ? "text-lg leading-6" : "text-[15px] leading-6",
              )}
            >
              {primary.value}
            </span>
            {rest.length > 0 ? (
              <span className="block text-xs tabular-nums text-muted-foreground">
                {rest.map((f) => `${f.label} ${f.value}`).join(" · ")}
              </span>
            ) : null}
          </p>
        ) : null}
      </div>

      <p className="mt-2 text-sm leading-6">{view.headline}</p>
      {!primary && rest.length > 0 ? (
        <p className="mt-1 text-[13px] tabular-nums text-muted-foreground">
          {rest.map((f) => `${f.label} ${f.value}`).join(" · ")}
        </p>
      ) : null}
      {explanation ? (
        <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
          <span className="font-medium text-foreground">Why it matters: </span>
          {explanation}
        </p>
      ) : null}
      {suggestedCheck ? (
        <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
          <span className="font-medium text-foreground">Suggested check: </span>
          {suggestedCheck}
        </p>
      ) : null}

      {related.length > 0 ? (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
          <Link2 aria-hidden="true" className="size-3.5" />
          Shares a record with
          {related.map((other) => (
            <a
              key={other.id}
              href={`#${flagDomId(other.id)}`}
              className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring sm:min-h-0"
            >
              {describeFinding(other).counterparty ?? FINDING_LABEL[other.kind]}
            </a>
          ))}
        </p>
      ) : null}

      <p className="mt-1 flex flex-wrap gap-x-4">
        {recordNode ? (
          <a href={mapNodeHref(recordNode)} className={linkClass}>
            See record
          </a>
        ) : null}
        <a href={mapNodeHref("agent:audit")} className={linkClass}>
          Found by Audit agent
        </a>
      </p>

      {finding.refs.length > 0 ? (
        <details className="group mt-2 text-[13px]">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring sm:min-h-0 [&::-webkit-details-marker]:hidden">
            <ChevronRight
              aria-hidden="true"
              className="size-3.5 transition-transform group-open:rotate-90 motion-reduce:transition-none"
            />
            View records ({finding.refs.length})
          </summary>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {finding.refs.map((ref) => (
              <li key={ref}>
                <code className="rounded border bg-muted/60 px-1.5 py-px font-mono text-[11px] text-foreground">
                  {ref}
                </code>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="mt-3 space-y-1.5">
        <label htmlFor={noteId} className="block text-[13px] font-medium">
          Note <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            id={noteId}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="Why you decided this"
            className="h-11 sm:h-9 sm:flex-1"
          />
          <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex">
            <Button disabled={busy !== null} onClick={() => decide("approved")}>
              <Check aria-hidden="true" />
              Confirm issue
            </Button>
            <Button variant="outline" disabled={busy !== null} onClick={() => decide("rejected")}>
              <X aria-hidden="true" />
              Dismiss flag
            </Button>
          </div>
        </div>
      </div>
      {shownError ? <p className="mt-2 text-sm text-destructive">{shownError}</p> : null}
    </motion.li>
  );
}
