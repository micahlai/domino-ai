import Link from "next/link";
import { fieldTraceHref } from "../../../lib/trace-links";
import type { WorkerChatContext } from "../../../lib/worker-chat-context";
import { formatExactCents } from "../baseline/format";
import { workspaceHref } from "../workspace/api";

/** Saved context stays inspectable beside the conversation, including after a draft reset. */
export function WorkerContext({
  context,
  companyId,
}: {
  context: WorkerChatContext;
  companyId: string;
}) {
  const { candidate, scenario, inputs } = context;
  const riskLowWeek = scenario.work?.weeks.find(
    (week) => week.usable === candidate.effect.scenarioLow,
  )?.weekStart;
  return (
    <details className="rounded-lg border px-4 py-3 text-sm" open data-testid="worker-chat-context">
      <summary className="cursor-pointer font-medium">From Worker: {candidate.fix.label}</summary>
      <div className="mt-3 space-y-3">
        <p>
          <span className="font-medium">Risk: </span>
          {scenario.title}
        </p>
        <p className="text-muted-foreground">{scenario.basis}</p>
        <p>
          Saved engine comparison: lowest usable cash in the risk forecast{" "}
          {formatExactCents(candidate.effect.scenarioLow)}
          {riskLowWeek ? ` in the week of ${riskLowWeek}` : ""}. With this fix:{" "}
          {formatExactCents(candidate.effect.lowPoint)}, week of {candidate.effect.lowWeekStart}.
        </p>
        <p className="text-muted-foreground">Cost and assumptions: {candidate.fix.costNote}</p>
        {candidate.recommendation ? <p>Advisor: {candidate.recommendation.text}</p> : null}
        {context.note ? <p className="whitespace-pre-wrap">Your note: {context.note}</p> : null}
        <p className="text-xs text-muted-foreground">
          Books as of {inputs.snapshot.asOf}; saved snapshot version {context.snapshotVersion}.
          {inputs.provenance
            ? ` ${inputs.provenance.label} Operating records and future events are reconstructed or illustrative.`
            : ""}{" "}
          Showing this fix does not accept it. Nothing is paid or moved.
        </p>
        <div className="flex flex-wrap gap-3 text-xs text-primary">
          <Link
            href={fieldTraceHref({
              companyId: context.fieldCompanyId,
              runId: context.runId,
              scenarioId: scenario.id,
              fixKind: candidate.fix.kind,
            })}
          >
            Open Worker calculation
          </Link>
          <Link href={workspaceHref(companyId, { runId: context.scenarioRunId })}>
            Open original risk forecast
          </Link>
          <Link href={workspaceHref(companyId, { runId: context.fixRunId })}>
            Open suggested fix forecast
          </Link>
        </div>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            Saved sources, changes and calculation details
          </summary>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words">
            {JSON.stringify(context, null, 2)}
          </pre>
        </details>
      </div>
    </details>
  );
}
