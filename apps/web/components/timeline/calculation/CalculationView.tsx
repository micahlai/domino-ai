"use client";

import { type RequestForQueries, useQueries } from "convex/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { timelineCalculationHref } from "../../../lib/trace-links";
import { HowWeGotHere } from "../../field/trace/HowWeGotHere";
import { getBaselineRef, readBaseline } from "../baseline/api";
import { type WorkspaceRun, getRunRef, readRun, workspaceHref } from "../workspace/api";
import { fieldOriginHref } from "../workspace/fieldOrigin";
import { calculationExplain } from "./explain";

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
  const originHref = fieldOriginHref(baseline.baseline.assumptionNote);
  const explain = calculationExplain(run, baseline.baseline, { fromSuggestion: !!originHref });
  return (
    <HowWeGotHere
      explain={explain}
      back={
        <Link
          href={workspaceHref(companyId, { runId: run.runId })}
          className="text-sm text-primary underline"
        >
          Back to Timeline
        </Link>
      }
      links={
        originHref || run.parentRunId ? (
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {originHref ? (
              <Link
                href={originHref}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Why that suggestion
              </Link>
            ) : null}
            {run.parentRunId ? (
              <Link
                className="font-medium text-primary underline-offset-4 hover:underline"
                href={timelineCalculationHref(companyId, run.parentRunId)}
              >
                View previous calculation
              </Link>
            ) : null}
          </p>
        ) : null
      }
    />
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
