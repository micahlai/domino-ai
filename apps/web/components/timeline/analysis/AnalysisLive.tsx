"use client";

import { useAction, useMutation, useQueries } from "convex/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { Skeleton } from "../../ui/skeleton";
import { ReadNotice } from "../workspace/CatalogPanel";
import { type WorkspaceRun, getRunRef, readRun, workspaceHref } from "../workspace/api";
import { RequestLedger } from "../workspace/requests";
import { type AnalysisActions, type AnalysisOutcome, AnalysisView } from "./AnalysisView";
import {
  analysisHref,
  getAnalysisRef,
  listAnalysesRef,
  outputRef,
  readAnalyses,
  readAnalysis,
  readOutput,
  retryRef,
  startRef,
} from "./api";

import { requestAnalysis } from "./requests";

function Ready({ run, analysisId }: { run: WorkspaceRun; analysisId: string | null }) {
  const router = useRouter();
  const key = useMemo(
    () => ({ companyId: run.companyId, runId: run.runId }),
    [run.companyId, run.runId],
  );
  const queries = useMemo(
    () => ({
      history: { query: listAnalysesRef, args: key },
      ...(analysisId
        ? { selected: { query: getAnalysisRef, args: { companyId: run.companyId, analysisId } } }
        : {}),
    }),
    [key, analysisId, run.companyId],
  );
  const raw = useQueries(queries) as Record<string, unknown>;
  const start = useMutation(startRef);
  const retry = useMutation(retryRef);
  const output = useAction(outputRef);
  const [ledger] = useState(() => new RequestLedger());
  async function write(retryAnalysisId: string | null): Promise<AnalysisOutcome> {
    const result = await requestAnalysis(key, retryAnalysisId, ledger, { start, retry });
    if (result.ok) router.push(analysisHref(run.companyId, run.runId, result.analysisId));
    return result;
  }
  const actions: AnalysisActions = {
    start: () => write(null),
    retry: (r) => write(r.analysisId),
    exportOutput: async (runId) => {
      try {
        const raw = await output({ companyId: run.companyId, runId });
        if (raw === null)
          return { ok: false, message: "No saved financial output was found for this timeline." };
        const json = readOutput(raw, { companyId: run.companyId, runId });
        return json
          ? { ok: true, json }
          : {
              ok: false,
              message:
                "The saved financial output could not be verified, so it is not offered for download.",
            };
      } catch {
        return {
          ok: false,
          message: "The financial output could not be read. Try again; this only reads saved data.",
        };
      }
    },
  };
  return (
    <AnalysisView
      run={run}
      selected={analysisId ? readAnalysis(raw.selected, { ...key, analysisId }, run) : null}
      history={readAnalyses(raw.history, key, run)}
      actions={actions}
    />
  );
}
function Connected({ companyId }: { companyId: string }) {
  const params = useSearchParams();
  const runId = params.get("runId");
  const analysisId = params.get("analysisId");
  const queries = useMemo(
    () => (runId ? { run: { query: getRunRef, args: { companyId, runId } } } : {}),
    [companyId, runId],
  );
  const raw = useQueries(queries as Parameters<typeof useQueries>[0]) as Record<string, unknown>;
  if (!runId)
    return (
      <div className="space-y-3 rounded-lg border p-5 text-sm">
        <p>Choose a saved timeline before opening analysis.</p>
        <Link href={workspaceHref(companyId)} className="text-primary hover:underline">
          Open saved timelines
        </Link>
      </div>
    );
  const read = readRun(raw.run, { companyId, runId });
  if (read.state !== "ready") return <ReadNotice read={read} what="source timeline" />;
  return <Ready key={`${companyId}:${runId}`} run={read.value} analysisId={analysisId} />;
}
export function AnalysisLive({ companyId }: { companyId: string }) {
  return (
    <Suspense
      fallback={
        <div aria-busy="true" className="space-y-3">
          <output className="text-sm text-muted-foreground">Opening the saved analysis...</output>
          <Skeleton className="h-40 w-full" />
        </div>
      }
    >
      {process.env.NEXT_PUBLIC_CONVEX_URL ? (
        <Connected companyId={companyId} />
      ) : (
        <p role="alert" className="rounded-lg border p-5 text-sm">
          This page is not connected to the analysis service, so saved results cannot be opened or
          created.
        </p>
      )}
    </Suspense>
  );
}
