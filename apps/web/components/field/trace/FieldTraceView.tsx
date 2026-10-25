"use client";

import {
  type FieldTrace,
  FieldTraceFixKindSchema,
  FieldTraceSchema,
} from "@/lib/field-trace-contract";
import { type RequestForQueries, useQueries } from "convex/react";
import { makeFunctionReference } from "convex/server";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { day, money } from "../worker/format";
import { traceStory } from "./story";

const getTrace = makeFunctionReference<
  "query",
  {
    companyId: string;
    runId: string;
    scenarioId?: string;
    fixKind?: FieldTrace["selection"]["fixKind"];
  },
  unknown
>("fieldTrace:get");

function readTrace(
  raw: unknown,
  key: { companyId: string; runId: string },
):
  | { state: "loading" }
  | { state: "missing" }
  | { state: "error" }
  | { state: "unusable" }
  | { state: "ready"; value: FieldTrace } {
  if (raw === undefined) return { state: "loading" };
  if (raw === null) return { state: "missing" };
  if (raw instanceof Error) return { state: "error" };
  const parsed = FieldTraceSchema.safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.run.companyId !== key.companyId ||
    parsed.data.run.runId !== key.runId
  )
    return { state: "unusable" };
  return { state: "ready", value: parsed.data };
}

export function FieldTraceView() {
  const search = useSearchParams();
  const companyId = search.get("companyId") ?? "";
  const runId = search.get("runId") ?? "";
  const scenarioId = search.get("scenarioId") ?? undefined;
  const rawFix = search.get("fixKind");
  const fix = rawFix ? FieldTraceFixKindSchema.safeParse(rawFix) : null;
  const fixKind = fix?.success ? fix.data : undefined;
  const valid = !!companyId && !!runId && (!rawFix || fix?.success) && (!rawFix || !!scenarioId);
  const requests = useMemo(() => {
    const request: RequestForQueries = {};
    if (valid)
      request.trace = {
        query: getTrace,
        args: {
          companyId,
          runId,
          ...(scenarioId && { scenarioId }),
          ...(fixKind && { fixKind }),
        },
      };
    return request;
  }, [valid, companyId, runId, scenarioId, fixKind]);
  const raw = useQueries(requests).trace as unknown;
  if (!valid)
    return (
      <Notice
        title="This calculation link is incomplete"
        text="Open an exact saved run link with a company and run ID."
      />
    );
  const trace = readTrace(raw, { companyId, runId });
  if (trace.state === "loading")
    return <Notice title="Reading the saved run" text="Loading recorded calculation evidence." />;
  if (trace.state === "missing")
    return (
      <Notice
        title="Saved run not found"
        text="This company and run do not have a matching record."
      />
    );
  if (trace.state === "error")
    return (
      <Notice
        title="Could not read this run"
        text="The backend is unavailable or did not return the requested trace."
      />
    );
  if (trace.state === "unusable")
    return (
      <Notice
        title="Saved run could not be verified"
        text="Its identity or receipt did not match this link."
      />
    );
  return <TraceContent trace={trace.value} />;
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <Link href="/field" className="text-sm text-primary underline">
        Back to Worker
      </Link>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-muted-foreground">{text}</p>
    </div>
  );
}

function TraceContent({ trace }: { trace: FieldTrace }) {
  const story = traceStory(trace);
  const candidate = trace.selection.fixKind
    ? trace.candidates.find(
        (c) =>
          c.scenarioId === trace.selection.scenarioId && c.fix.kind === trace.selection.fixKind,
      )
    : null;
  const relevant = trace.operations.filter(
    (op) =>
      !trace.selection.scenarioId ||
      op.refs.length === 0 ||
      op.refs.includes(trace.selection.scenarioId) ||
      (candidate && op.refs.includes(candidate.fix.id)),
  );
  return (
    <article className="mx-auto max-w-4xl space-y-8 pb-16">
      <Link href="/field" className="text-sm text-primary underline">
        Back to Worker
      </Link>
      <header className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Recorded {trace.evidence} run · {trace.run.status}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">{story.title}</h1>
        <p className="text-sm text-muted-foreground">
          {trace.inputs?.company.name ?? "Company name unavailable"} · Snapshot{" "}
          {trace.run.snapshotVersion} · As of {day(trace.run.asOf) ?? trace.run.asOf}
        </p>
      </header>
      {trace.evidence === "legacy" || trace.limitations.length > 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <strong>Evidence limits</strong>
          <ul className="mt-1 list-disc pl-5">
            {trace.limitations.length ? (
              trace.limitations.map((line) => <li key={line}>{line}</li>)
            ) : (
              <li>Some older run inputs were not saved.</li>
            )}
          </ul>
        </div>
      ) : null}
      <section aria-label="How we got here" className="rounded-lg border bg-card p-6">
        <h2 className="text-lg font-semibold">How we got here</h2>
        <ol className="mt-5 space-y-5">
          {[
            ["1. Data used", story.data],
            ["2. What changed", story.changed],
            ["3. What was calculated", story.checked],
            ["4. Why this result", story.outcome],
          ].map(([label, value]) => (
            <li key={label}>
              <h3 className="text-sm font-semibold">{label}</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{value}</p>
            </li>
          ))}
        </ol>
      </section>
      {candidate ? (
        <section className="rounded-lg border bg-card p-5">
          <h2 className="font-semibold">Saved fix result</h2>
          <p className="mt-2 text-sm">
            Lowest cash with this fix: <strong>{money(candidate.effect.lowPoint)}</strong> in the
            week of {day(candidate.effect.lowWeekStart) ?? candidate.effect.lowWeekStart}.
          </p>
          <p className="mt-1 text-sm">
            {candidate.effect.survives
              ? "Cash and payment checks passed."
              : "A cash or payment check still failed."}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{candidate.fix.costNote}</p>
        </section>
      ) : null}
      {relevant.length > 0 ? (
        <details className="rounded-lg border bg-card p-5">
          <summary className="cursor-pointer font-semibold">
            Recorded steps ({relevant.length})
          </summary>
          <ol className="mt-4 border-l pl-5 space-y-4">
            {relevant.map((op) => (
              <li key={op.id} className="text-sm">
                <strong>{op.toolLabel ?? op.summary}</strong>
                {op.toolLabel ? <p className="text-muted-foreground">{op.summary}</p> : null}
                <span className="text-xs text-muted-foreground">{op.status ?? "recorded"}</span>
              </li>
            ))}
          </ol>
          {trace.truncation.operations ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Older steps were omitted from this bounded receipt.
            </p>
          ) : null}
        </details>
      ) : null}
      <details className="rounded-lg border bg-card p-5">
        <summary className="cursor-pointer font-semibold">Technical details</summary>
        <div className="mt-4 space-y-3 text-xs text-muted-foreground">
          <p>Company ID: {trace.run.companyId}</p>
          <p>Run ID: {trace.run.runId}</p>
          <p>Snapshot ID: {trace.run.snapshotId}</p>
          <p>Scenario ID: {trace.selection.scenarioId ?? "none"}</p>
          <p>Fix kind: {trace.selection.fixKind ?? "none"}</p>
          <p>
            Source model:{" "}
            {trace.inputs
              ? `${trace.inputs.model.id} version ${trace.inputs.model.version}`
              : "not saved"}
          </p>
          <p>
            Dataset:{" "}
            {trace.inputs
              ? `${trace.inputs.company.datasetId} version ${trace.inputs.company.datasetVersion ?? "unknown"}`
              : "not saved"}
          </p>
          {trace.inputs?.sources.map((source, index) => (
            <p key={`${source.kind}-${index}`}>
              Source {source.kind}: {source.tieOut}; {source.step}
            </p>
          ))}
          <p>
            Providers:{" "}
            {trace.providers.length
              ? trace.providers
                  .map((p) => `${p.provider} ${p.kind}: ${p.attribution}, ${p.status}`)
                  .join("; ")
              : "No provider receipt recorded"}
          </p>
          <p>
            Advisor: {trace.aiSummary?.status ?? "No advisor summary recorded"}. Coordinator:{" "}
            {trace.coordinator?.status ?? "No coordinator record"}.
          </p>
          {trace.truncation.providers ? <p>Some provider receipts were omitted.</p> : null}
        </div>
      </details>
    </article>
  );
}
