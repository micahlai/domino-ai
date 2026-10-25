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
import { HowWeGotHere } from "./HowWeGotHere";
import { traceExplain } from "./explain";

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
        text="Its saved record did not match this link."
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
  return (
    <HowWeGotHere
      explain={traceExplain(trace)}
      back={
        <Link href="/field" className="text-sm text-primary underline">
          Back to Worker
        </Link>
      }
    />
  );
}
