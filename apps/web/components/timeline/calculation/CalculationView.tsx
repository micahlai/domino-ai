"use client";

import type { Change } from "@domino/contracts";
import { type RequestForQueries, useQueries } from "convex/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { timelineCalculationHref } from "../../../lib/trace-links";
import { getBaselineRef, readBaseline } from "../baseline/api";
import { formatExactCents, formatFullDate, formatSavedAt } from "../baseline/format";
import { type WorkspaceRun, getRunRef, readRun, workspaceHref } from "../workspace/api";
import { fieldOriginHref } from "../workspace/fieldOrigin";
import { runHeadline } from "../workspace/summary";
import { assumptionSummary } from "./assumptions";

export function changeText(change: Change): string {
  switch (change.kind) {
    case "delay_invoice":
      return `An invoice was delayed by ${change.days} days.`;
    case "lose_invoice":
      return "An expected invoice was removed.";
    case "churn":
      return `A customer was lost from ${formatFullDate(change.fromDate)}.`;
    case "add_cash":
      return `${change.label}: ${formatExactCents(change.amount)} added on ${formatFullDate(change.date)}.`;
    case "remove_cash":
      return `${change.label}: ${formatExactCents(change.amount)} removed on ${formatFullDate(change.date)}.`;
    case "delay_bill":
      return `A bill was delayed by ${change.days} days.`;
    case "discount_early_pay":
      return `An invoice was offered a ${change.percent}% discount to pay on ${formatFullDate(change.payOn)}.`;
    case "shift_hire":
      return `${change.label} moved from ${formatFullDate(change.fromDate)} to ${formatFullDate(change.toDate)}; saved monthly cost ${formatExactCents(change.monthlyCost)}.`;
  }
}

export function CalculationView({ companyId }: { companyId: string }) {
  const search = useSearchParams();
  const runId = search.get("runId") ?? "";
  const valid = !!companyId && !!runId;
  const queries = useMemo(() => {
    const request: RequestForQueries = {};
    if (valid) {
      request.run = { query: getRunRef, args: { companyId, runId } };
      // The separate baseline read verifies that the source book still exists under this company.
      // The precise baseline ID is available only after the run loads below.
    }
    return request;
  }, [valid, companyId, runId]);
  const rawRun = useQueries(queries).run as unknown;
  if (!valid)
    return (
      <State
        title="This calculation link is incomplete"
        detail="Open a saved run link with its exact run ID."
      />
    );
  const run = readRun(rawRun, { companyId, runId });
  if (run.state === "loading")
    return (
      <State
        title="Reading saved calculation"
        detail="Loading the recorded inputs and engine outputs."
      />
    );
  if (run.state === "missing")
    return (
      <State
        title="Saved calculation not found"
        detail="No matching run exists under this company."
      />
    );
  if (run.state !== "ready")
    return (
      <State
        title="Could not verify saved calculation"
        detail="The backend read failed or the saved run did not match this link."
      />
    );
  return <WithBaseline companyId={companyId} run={run.value} />;
}

function WithBaseline({ companyId, run }: { companyId: string; run: WorkspaceRun }) {
  const key = useMemo(
    () => ({ companyId, runId: run.baselineRunId }),
    [companyId, run.baselineRunId],
  );
  const requests = useMemo(() => ({ baseline: { query: getBaselineRef, args: key } }), [key]);
  const raw = useQueries(requests).baseline as unknown;
  const baseline = readBaseline(raw, key);
  if (baseline.state === "loading")
    return (
      <State title="Reading saved source books" detail="Checking the baseline used for this run." />
    );
  if (baseline.state !== "ready" || baseline.baseline.seedHash !== run.baseline.seedHash)
    return (
      <State
        title="Could not verify source books"
        detail="The saved baseline is unavailable or no longer matches this calculation."
      />
    );
  const firstBreach = run.receipts.find((r) => r.status === "breached");
  const originHref = fieldOriginHref(baseline.baseline.assumptionNote);
  return (
    <article className="mx-auto max-w-4xl space-y-8 pb-16">
      <Link
        href={workspaceHref(companyId, { runId: run.runId })}
        className="text-sm text-primary underline"
      >
        Back to Timeline
      </Link>
      <header className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Recorded calculation · completed {formatSavedAt(run.savedAt)}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">{runHeadline(run)}</h1>
        <p className="text-sm text-muted-foreground">
          {baseline.baseline.companyName} ·{" "}
          {run.label || (run.kind === "baseline" ? "Starting plan" : "Saved scenario")}
        </p>
      </header>
      {originHref ? (
        <p className="text-sm text-muted-foreground">
          Started from a saved Field suggestion.{" "}
          <Link
            href={originHref}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            See suggestion
          </Link>
        </p>
      ) : null}
      <section className="rounded-lg border bg-card p-6">
        <h2 className="text-lg font-semibold">How we got here</h2>
        <ol className="mt-5 space-y-5">
          <li>
            <h3 className="text-sm font-semibold">1. Data used</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              The saved {baseline.baseline.companyName} source book and its{" "}
              {run.forecast.weeks.length}-week starting forecast, from books as of{" "}
              {formatFullDate(baseline.baseline.seed.snapshot.asOf)}.{" "}
              {assumptionSummary(baseline.baseline.assumptionNote)}
            </p>
          </li>
          <li>
            <h3 className="text-sm font-semibold">2. What changed</h3>
            {run.ownChanges.length ? (
              <ul className="mt-1 list-disc pl-5 text-sm leading-6 text-muted-foreground">
                {run.ownChanges.map((c, i) => (
                  <li key={`${c.kind}-${i}`}>{changeText(c)}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {run.kind === "rules"
                  ? `The saved cash rules were revised. ${run.constraintNote}`
                  : "No new event or cash change was added in this run."}
              </p>
            )}
          </li>
          <li>
            <h3 className="text-sm font-semibold">3. What was calculated</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              The recorded engine run applied {run.changes.length} total changes, forecast{" "}
              {run.forecast.weeks.length} weeks, then checked {run.receipts.length} saved rules.
              Status: {run.operation.status}.
            </p>
          </li>
          <li>
            <h3 className="text-sm font-semibold">4. Why this result</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Lowest usable cash was {formatExactCents(run.forecast.lowPoint.usable)} in the week of{" "}
              {formatFullDate(run.forecast.lowPoint.weekStart)}.{" "}
              {firstBreach
                ? `${firstBreach.label} was breached${firstBreach.weekStart ? ` in the week of ${formatFullDate(firstBreach.weekStart)}` : ""}.`
                : run.receipts.length
                  ? "No saved rule was broken."
                  : "No rule checks were saved."}
            </p>
          </li>
        </ol>
      </section>
      {run.parentRunId ? (
        <Link
          className="text-sm text-primary underline"
          href={timelineCalculationHref(companyId, run.parentRunId)}
        >
          Compare
        </Link>
      ) : null}
      <details className="rounded-lg border bg-card p-5">
        <summary className="cursor-pointer font-semibold">Recorded steps and rule checks</summary>
        <ol className="mt-4 border-l pl-5 space-y-3 text-sm">
          <li>Read saved baseline and assumptions</li>
          <li>Apply {run.changes.length} saved changes to the forecast</li>
          <li>Save {run.forecast.weeks.length} forecast weeks</li>
          {run.receipts.map((r) => (
            <li key={r.constraintId}>
              {r.label}: {r.status.replaceAll("_", " ")}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">
          This was a synchronous saved engine calculation. No live agent or provider work is
          implied.
        </p>
      </details>
      <details className="rounded-lg border bg-card p-5">
        <summary className="cursor-pointer font-semibold">Technical details</summary>
        <div className="mt-4 space-y-2 text-xs text-muted-foreground">
          <p>Company ID: {run.companyId}</p>
          <p>Run ID: {run.runId}</p>
          <p>Baseline ID: {run.baselineRunId}</p>
          <p>Parent ID: {run.parentRunId ?? "none"}</p>
          <p>Input hash: {run.inputHash}</p>
          <p>Method: {run.methodVersion}</p>
          <p>Rule version: {run.constraintVersion}</p>
          <p>Operation ID: {run.operation.id}</p>
          <p>Saved source note: {baseline.baseline.assumptionNote || "none"}</p>
        </div>
      </details>
    </article>
  );
}

function State({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mx-auto max-w-3xl space-y-2">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}
