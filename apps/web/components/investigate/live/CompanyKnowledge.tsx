"use client";

import type { HistoricalAssumption } from "@domino/contracts";
import { useQueries } from "convex/react";
import { type ReactNode, useMemo } from "react";
import { api } from "../../../convex/_generated/api";
import { formatCents } from "../../../lib/format";
import { type RunKnowledge, projectRunKnowledge } from "../../../lib/investigation-knowledge";
import { formatReportDate } from "../../historical/format";
import { CASE_ID } from "../../historical/live";

// Company knowledge detail: what the saved baseline forecast was computed from. It reads the
// frozen run through the existing getRun, passes the raw payload (roles included) to the
// reviewed projector, and only formats the result. It adds no fact, learning or arithmetic.

const METRIC_LABEL: Record<string, string> = {
  fx_effect_on_cash: "Exchange-rate effect on cash",
  adjusted_ebitda: "Adjusted EBITDA",
};
const metricLabel = (metric: string) =>
  METRIC_LABEL[metric] ?? `${metric[0]?.toUpperCase()}${metric.slice(1).replaceAll("_", " ")}`;

// A timestamp's calendar date as written (the contract's definition of local date), as live.ts does.
const day = (timestamp: string) => formatReportDate(timestamp.slice(0, 10));

const money = (cents: number, currency: string) =>
  currency === "USD" ? formatCents(cents) : `${formatCents(cents).replace("$", "")} ${currency}`;

function period(p: RunKnowledge["facts"][number]["period"]) {
  return p.kind === "instant"
    ? `on ${formatReportDate(p.date)}`
    : `${formatReportDate(p.start)} to ${formatReportDate(p.end)}`;
}

function span(low: number, high: number, show: (n: number) => string) {
  return low === high ? show(low) : `${show(low)} to ${show(high)}`;
}

const ASSUMPTION_KIND: Record<HistoricalAssumption["label"], string> = {
  synthetic: "Assumed, not reported",
  counterfactual: "A decision not taken",
  hindsight: "Uses later information",
};

function assumptionValue(a: RunKnowledge["assumptions"][number], currency: string) {
  const { unit, low, high } = a.value;
  if (unit === "cents") return span(low, high, (n) => money(n, currency));
  return span(low, high, (n) => `${n}`) + (unit === "days" ? " days" : " basis points");
}

const FEASIBLE: Record<HistoricalAssumption["feasibleAtCutoff"], string> = {
  yes: "Feasible at the time",
  no: "Not feasible at the time",
  unknown: "Not known whether it was feasible at the time",
};

function Note({
  title,
  children,
  alert = true,
}: { title: string; children?: ReactNode; alert?: boolean }) {
  return (
    <div role={alert ? "alert" : "status"} className="rounded-lg border p-3 text-sm">
      <p className="font-medium">{title}</p>
      {children ? <div className="mt-1 text-muted-foreground">{children}</div> : null}
    </div>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return <h4 className="mt-4 text-xs font-medium text-muted-foreground first:mt-0">{children}</h4>;
}

function Facts({ k }: { k: RunKnowledge }) {
  const sources = new Map(k.sources.map((s) => [s.id, s]));
  return (
    <ul className="space-y-3">
      {k.facts.map((fact) => (
        <li key={fact.id}>
          <p>
            <span className="font-medium">{metricLabel(fact.metric)}</span>{" "}
            <span className="text-muted-foreground">{period(fact.period)}</span>
          </p>
          <p className="font-medium">{money(fact.cents, fact.currency)}</p>
          <p className="text-xs text-muted-foreground">
            {fact.kind === "reported"
              ? // Links live once, in the saved sources below; here the title only matters if there are several.
                `Reported${k.sources.length > 1 ? ` in ${sources.get(fact.sourceId)?.title}` : ""}: ${fact.locator}. Published ${day(fact.availableAt)}.`
              : `Derived from reported figures: ${fact.derivation}.`}
          </p>
        </li>
      ))}
    </ul>
  );
}

function Assumptions({ k }: { k: RunKnowledge }) {
  return (
    <ul className="space-y-3">
      {k.assumptions.map((a) => (
        <li key={a.id}>
          <p className="font-medium">{a.description}</p>
          <p className="text-xs text-muted-foreground">
            {ASSUMPTION_KIND[a.label]} · {assumptionValue(a, k.currency)} · from{" "}
            {formatReportDate(a.effectiveFrom)}
          </p>
          {a.oneTimeCost ? (
            <p className="text-xs text-muted-foreground">
              Upfront cost:{" "}
              {span(a.oneTimeCost.low, a.oneTimeCost.high, (n) => money(n, k.currency))}
            </p>
          ) : null}
          {a.benefitLagDays !== undefined ? (
            <p className="text-xs text-muted-foreground">
              Benefit starts {a.benefitLagDays} days after the decision.
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">{FEASIBLE[a.feasibleAtCutoff]}.</p>
        </li>
      ))}
    </ul>
  );
}

function Ready({ k }: { k: RunKnowledge }) {
  return (
    <div>
      <p className="text-muted-foreground">
        Saved with the forecast. Knowledge cutoff {day(k.knowledgeCutoff)}: nothing published later
        is included, even after the results are revealed. Amounts are in {k.currency}.
      </p>
      <Heading>Facts</Heading>
      <Facts k={k} />
      {k.assumptions.length > 0 ? (
        <>
          <Heading>Assumptions</Heading>
          <Assumptions k={k} />
        </>
      ) : null}
      <details className="mt-4 border-t pt-2 text-xs">
        <summary className="flex min-h-11 cursor-pointer items-center rounded text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
          Saved run details
        </summary>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 pb-2">
          <dt className="text-muted-foreground">Run</dt>
          <dd className="break-all font-mono">{k.runId}</dd>
          <dt className="text-muted-foreground">Method</dt>
          <dd className="break-all font-mono">
            {k.method.id} {k.method.version}
          </dd>
          <dt className="text-muted-foreground">Input hash</dt>
          <dd className="break-all font-mono">{k.inputHash}</dd>
        </dl>
      </details>
    </div>
  );
}

type Raw = { run?: unknown };

/** From an already-fetched getRun result. Unknown is never drawn as empty or as another run's. */
export function CompanyKnowledgeView({ runId, raw }: { runId?: string; raw: Raw }) {
  if (!runId)
    return (
      <Note alert={false} title="No structured data saved yet.">
        Facts and assumptions are saved together with the forecast. Only the saved sources below are
        known so far.
      </Note>
    );
  if (raw.run === undefined)
    return (
      <Note alert={false} title="Loading the saved facts.">
        Reading what the forecast was based on.
      </Note>
    );
  if (raw.run instanceof Error)
    return (
      <Note title="Could not load the saved facts.">
        The saved record could not be read right now. Nothing was changed.
      </Note>
    );

  let knowledge: RunKnowledge | undefined;
  if (typeof raw.run === "object" && raw.run !== null) {
    const { runId: savedId, run, inputSnapshot } = raw.run as Record<string, unknown>;
    try {
      knowledge = projectRunKnowledge({ runId: savedId, run, inputSnapshot });
    } catch {
      // Falls through to the shared "not shown" note below.
    }
  }
  if (!knowledge)
    return (
      <Note title="The saved facts were not in the expected shape.">
        Nothing is shown rather than guessing.
      </Note>
    );
  if (knowledge.runId !== runId || knowledge.caseId !== CASE_ID)
    return (
      <Note title="That saved run does not match this investigation.">
        Nothing is shown rather than guessing.
      </Note>
    );
  return <Ready k={knowledge} />;
}

/** Reads only the baseline the forecast step saved, never the newest or an alternative run. */
export function CompanyKnowledge({ runId }: { runId?: string }) {
  // Memoized: useQueries resubscribes when the map's identity changes.
  const queries = useMemo(
    () => ({
      ...(runId ? { run: { query: api.historical.getRun, args: { caseId: CASE_ID, runId } } } : {}),
    }),
    [runId],
  );
  const raw = useQueries(queries) as Raw;
  return <CompanyKnowledgeView runId={runId} raw={raw} />;
}
