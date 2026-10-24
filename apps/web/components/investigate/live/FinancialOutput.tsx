"use client";

import { useQueries } from "convex/react";
import { type ReactNode, useMemo } from "react";
import { api } from "../../../convex/_generated/api";
import { HistoricalReplay } from "../../historical/HistoricalReplay";
import {
  type AlternativeData,
  AlternativeDataSchema,
  type BaselineData,
  BaselineDataSchema,
  CASE_ID,
  type CaseData,
  CaseDataSchema,
  RevealDataSchema,
  alternativeIssue,
  buildView,
} from "../../historical/live";
import type { OutputTarget } from "./adapt";

// The saved run's chart, drawn by the existing historical replay from the existing saved reads.
// This file only chooses which saved records a node may show; it computes no money.

type Raw = { case?: unknown; run?: unknown; reveal?: unknown; alt?: unknown };

function Note({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div role="alert" className="rounded-lg border p-4 text-sm">
      <p className="font-medium">{title}</p>
      {children ? <div className="mt-1 text-muted-foreground">{children}</div> : null}
    </div>
  );
}

/** The map must keep its identity between renders: useQueries resubscribes on a new one. */
export function useOutputQueries({ stage, baselineRunId, altRunId, revealed }: OutputTarget) {
  return useMemo(
    () => ({
      case: {
        query: api.historical.getCase,
        args: { caseId: CASE_ID, runId: baselineRunId },
      },
      run: { query: api.historical.getRun, args: { caseId: CASE_ID, runId: baselineRunId } },
      // The forecast view, and an alternative drawn before any reveal, never read the reveal,
      // so nothing later can reach them.
      ...(stage === "reveal" || (stage === "alternative" && revealed)
        ? { reveal: { query: api.historical.getReveal, args: { runId: baselineRunId } } }
        : {}),
      ...(stage === "alternative" && altRunId
        ? { alt: { query: api.historical.getRun, args: { caseId: CASE_ID, runId: altRunId } } }
        : {}),
    }),
    [stage, baselineRunId, altRunId, revealed],
  );
}

const loading = <HistoricalReplay status="loading" />;

/**
 * buildView only attaches an alternative once a reveal agrees, so give it an empty one (no
 * comparisons, so no observed value or evidence can enter) and strip what that implies: the
 * revealed stage, the reveal date and the comparison rows. Nothing is computed here.
 */
function savedAlternativeView(
  caseData: CaseData,
  baseline: BaselineData,
  alternative: AlternativeData,
) {
  const shown = buildView({
    caseData: { ...caseData, revealed: true },
    baseline,
    reveal: {
      runId: baseline.run.id,
      revealedThrough: caseData.knowledgeCutoff,
      revealedAt: "",
      comparisons: [],
    },
    alternative,
  });
  const { revealedOn: _, ...dates } = shown.dates;
  return { ...shown, stage: "baseline" as const, dates, comparison: [] };
}

/** From already-fetched results, so it renders without hooks. Unknown is never drawn as empty. */
export function FinancialOutputView({ target, raw }: { target: OutputTarget; raw: Raw }) {
  // The API allows an alternative before the reveal: it is saved, so draw it, but with no outcome.
  const early = target.stage === "alternative" && !target.revealed;
  const noReveal = target.stage === "forecast" || early;
  const wanted = noReveal ? [raw.case, raw.run] : [raw.case, raw.run, raw.reveal];
  if (wanted.some((r) => r instanceof Error))
    return (
      <Note title="Could not load this result.">
        The saved record could not be read right now. Nothing was changed.
      </Note>
    );
  if (wanted.some((r) => r === undefined)) return loading;

  const caseData = CaseDataSchema.safeParse(raw.case);
  const baseline = BaselineDataSchema.safeParse(raw.run);
  const reveal = noReveal ? undefined : RevealDataSchema.safeParse(raw.reveal);
  if (!caseData.success || !baseline.success || (reveal && !reveal.success))
    return (
      <Note title="The saved data was not in the expected shape.">
        Nothing is shown rather than guessing.
      </Note>
    );
  if (baseline.data.run.id !== target.baselineRunId)
    return (
      <Note title="That saved run does not match this investigation.">
        Nothing is shown rather than guessing.
      </Note>
    );

  const revealData = reveal?.success ? reveal.data : null;
  if (!noReveal) {
    // The reveal step succeeded, so its record must exist and agree with the frozen case view.
    if (!revealData)
      return (
        <Note title="The reveal is not readable yet.">
          The step finished, but its saved comparison is not available. Nothing later is shown.
        </Note>
      );
    if (!caseData.data.revealed) return loading;
  }

  let alternative: AlternativeData | undefined;
  if (target.stage === "alternative") {
    if (raw.alt instanceof Error)
      return <Note title="The alternative could not be loaded.">Nothing was changed.</Note>;
    if (raw.alt === undefined) return loading;
    const parsed = AlternativeDataSchema.safeParse(raw.alt);
    if (!parsed.success)
      return (
        <Note title="The alternative was not in the expected shape.">
          It is not shown rather than guessing.
        </Note>
      );
    const issue = alternativeIssue(baseline.data, parsed.data);
    if (issue || parsed.data.run.id !== target.altRunId)
      return (
        <Note title="That alternative does not belong to this forecast.">
          {issue?.message ?? "It is not shown rather than guessing."}
        </Note>
      );
    alternative = parsed.data;
  }

  const view =
    early && alternative
      ? savedAlternativeView(caseData.data, baseline.data, alternative)
      : buildView({
          caseData: caseData.data,
          baseline: baseline.data,
          reveal: revealData,
          alternative,
        });
  // A hidden element replaces the replay's default "activity not connected" panel, which does
  // not apply to a conversation.
  return <HistoricalReplay view={view} activity={<span hidden />} />;
}

export function FinancialOutput({ target }: { target: OutputTarget }) {
  const raw = useQueries(useOutputQueries(target));
  return <FinancialOutputView target={target} raw={raw} />;
}
