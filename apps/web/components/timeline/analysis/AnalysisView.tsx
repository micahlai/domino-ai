"use client";

import type { Forecast } from "@domino/contracts";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { formatExactCents, formatFullDate, formatSavedAt } from "../baseline/format";
import { ReadNotice } from "../workspace/CatalogPanel";
import { Panel, ReceiptsPanel, formatDelta } from "../workspace/RunPanels";
import { WorkspaceChart } from "../workspace/WorkspaceChart";
import { type Read, type WorkspaceRun, workspaceHref } from "../workspace/api";
import { changeText } from "../workspace/drafts";
import { AnalysisProof } from "./AnalysisProof";
import {
  type AnalysisReceipt,
  type AnalysisResponse,
  type AnalysisRisk,
  analysisHref,
  canAnalyze,
  canRetry,
} from "./api";

export type AnalysisOutcome = { ok: true } | { ok: false; message: string };
export type AnalysisActions = {
  start: () => Promise<AnalysisOutcome>;
  retry: (receipt: AnalysisReceipt) => Promise<AnalysisOutcome>;
  exportOutput: (
    runId: string,
  ) => Promise<{ ok: true; json: string } | { ok: false; message: string }>;
};
export type AnalysisViewProps = {
  run: WorkspaceRun;
  selected: Read<AnalysisReceipt> | null;
  history: Read<AnalysisReceipt[]>;
  actions: AnalysisActions;
  disabled?: string;
};

export function AnalysisView({ run, selected, history, actions, disabled }: AnalysisViewProps) {
  const [reviewedFor, setReviewedFor] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const receipt = selected?.state === "ready" ? selected.value : null;
  const target = receipt && canRetry(receipt) ? receipt.analysisId : run.runId;
  const reviewed = reviewedFor === target;
  const active =
    receipt?.status === "queued" ||
    receipt?.status === "running" ||
    (history.state === "ready" &&
      history.value.some((r) => r.status === "queued" || r.status === "running"));
  const allowed = canAnalyze(run);
  const unavailable =
    history.state !== "ready" || (selected !== null && selected.state !== "ready");
  async function launch() {
    if (pending || active || !allowed || !reviewed || disabled || unavailable) return;
    setPending(true);
    setMessage(undefined);
    try {
      const result =
        receipt && canRetry(receipt) ? await actions.retry(receipt) : await actions.start();
      if (!result.ok) setMessage(result.message);
      else setReviewedFor(null);
    } catch {
      setMessage(
        "The result could not be confirmed. Try the same request again to avoid starting it twice.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <article
      className="min-w-0 max-w-full space-y-6 [overflow-wrap:anywhere]"
      data-testid="timeline-analysis"
    >
      <header className="space-y-2">
        <Link
          className="text-sm text-primary hover:underline"
          href={workspaceHref(run.companyId, { runId: run.runId })}
        >
          Open the source timeline
        </Link>
        <h2 className="text-2xl font-medium">
          See what could put {run.baseline.companyName}&rsquo;s cash at risk
        </h2>
        <p className="text-sm text-muted-foreground">
          Analysis starts from &ldquo;{run.label}&rdquo; and its saved rules. It tests possible
          events and compares simulated responses across these 13 weeks. Every result is saved;
          opening it again does not rerun analysis.
        </p>
      </header>
      <Panel
        title={
          receipt && canRetry(receipt)
            ? "Review another analysis attempt"
            : "Review before starting"
        }
        testId="analysis-launch"
      >
        <p className="text-sm">
          The service will generate at most 3 risks and 2 responses for each risk using the selected
          records. These are hypothetical scenarios. Responses are simulated suggestions and do not
          move money or approve an action.
        </p>
        {!allowed ? (
          <output className="text-sm text-muted-foreground">
            Analysis currently starts from an imported baseline or a rules-only timeline with no
            earlier events. This timeline already includes events. Open its baseline or a rules-only
            timeline to start analysis.
          </output>
        ) : null}
        {disabled ? <p className="text-sm text-muted-foreground">{disabled}</p> : null}
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1 size-4 shrink-0 accent-primary"
            checked={reviewed}
            disabled={!!disabled || !allowed || !!active || pending || unavailable}
            onChange={(e) => setReviewedFor(e.target.checked ? target : null)}
            data-testid="analysis-review"
          />
          <span>
            I reviewed the source timeline and rules. Start a bounded analysis using these saved
            inputs.
          </span>
        </label>
        <Button
          onClick={launch}
          disabled={!!disabled || !allowed || !!active || pending || !reviewed || unavailable}
          className="h-auto max-w-full whitespace-normal"
          data-testid="analysis-start"
        >
          {pending
            ? "Confirming the request..."
            : active
              ? "Analysis is in progress"
              : receipt && canRetry(receipt)
                ? "Start another attempt"
                : "Start analysis"}
        </Button>
        {message ? (
          <p role="alert" className="text-sm text-[#E6A5B9]">
            {message}
          </p>
        ) : null}
      </Panel>
      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {selected === null ? (
            <Panel title="Choose a saved analysis">
              <p className="text-sm text-muted-foreground">
                Start analysis when you are ready, or open a saved attempt from the list.
              </p>
            </Panel>
          ) : selected.state !== "ready" ? (
            <ReadNotice read={selected} what="saved analysis" />
          ) : (
            <AnalysisResult
              key={selected.value.analysisId}
              run={run}
              receipt={selected.value}
              actions={actions}
            />
          )}
        </div>
        <div className="min-w-0 space-y-6">
          <Panel title="Saved analysis attempts" testId="analysis-history">
            {history.state !== "ready" ? (
              <ReadNotice read={history} what="analysis history" />
            ) : history.value.length ? (
              <ul className="space-y-3">
                {history.value.map((r) => (
                  <li key={r.analysisId} className="space-y-1 text-sm">
                    <Link
                      aria-current={r.analysisId === receipt?.analysisId ? "page" : undefined}
                      className="text-primary hover:underline"
                      href={analysisHref(run.companyId, run.runId, r.analysisId)}
                    >
                      Open analysis saved {formatSavedAt(r.savedAt)}
                    </Link>
                    <p className="text-xs text-muted-foreground">{STATUS[r.status]}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No attempts saved for this timeline.</p>
            )}
            <p className="text-xs text-muted-foreground">
              Shows at most 20 recent attempts. Earlier saved links still open directly.
            </p>
          </Panel>
          <ExportPanel runId={run.runId} exportOutput={actions.exportOutput} />
        </div>
      </div>
    </article>
  );
}
const STATUS = {
  queued: "Waiting to start",
  running: "Checking risks and responses",
  succeeded: "Analysis complete",
  partial: "Some results could not be completed",
  failed: "Analysis did not complete",
};

function AnalysisResult({
  run,
  receipt: r,
  actions,
}: { run: WorkspaceRun; receipt: AnalysisReceipt; actions: AnalysisActions }) {
  return (
    <div className="min-w-0 space-y-6" data-testid="analysis-result">
      <Panel title={STATUS[r.status]} testId="analysis-status">
        <Badge variant="outline">{r.status}</Badge>
        {r.status === "queued" || r.status === "running" ? (
          <output className="text-sm">
            This saved status updates while the bounded job runs. You can leave and reopen this
            link. An abandoned attempt will be marked failed instead of waiting indefinitely.
          </output>
        ) : null}
        {r.status === "partial" || r.status === "failed" ? (
          <p role="alert" className="text-sm">
            {r.status === "partial"
              ? "The results below are incomplete. A new reviewed attempt keeps this record intact."
              : "No complete analysis is available from this attempt. Review above to start another attempt."}
            {r.errorCode ? ` Service reason: ${r.errorCode}.` : ""}
          </p>
        ) : null}
        {r.warnings.length ? (
          <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
            {r.warnings.map((w, i) => (
              <li key={`${i}-${w}`}>{w}</li>
            ))}
          </ul>
        ) : null}
        {r.resilience ? (
          <div className="space-y-2">
            <p className="text-sm">
              <strong>
                {r.resilience.survivedCount} of {r.resilience.scenarioCount} tested combinations
              </strong>{" "}
              met the tested requirements.
            </p>
            <p className="text-sm">
              Weighted scenario index: {r.resilience.weightedScenarioIndex}. This index is not a
              probability of survival.
            </p>
            <p className="text-xs text-muted-foreground">{r.resilience.scope}</p>
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">
          An unknown or beyond-horizon rule is not confirmed compliance. Cash checks cover weekly
          close in this saved 13-week forecast.
        </p>
      </Panel>
      {r.risks.map((risk) => (
        <RiskPanel
          key={risk.id}
          run={run}
          risk={risk}
          responses={r.responses.filter((x) => x.riskId === risk.id)}
          exportOutput={actions.exportOutput}
        />
      ))}
      {(r.status === "succeeded" || r.status === "partial") && !r.risks.length ? (
        <p className="text-sm text-muted-foreground">
          No risk scenarios were saved in this attempt.
        </p>
      ) : null}
      <details className="min-w-0 rounded-lg border p-4 text-xs">
        <summary className="cursor-pointer text-sm">Where this analysis came from</summary>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {[
            ["Analysis", r.analysisId],
            ["Source timeline", r.runId],
            ["Input fingerprint", r.inputHash],
            ["Rules version", r.constraintVersion],
            ["Method", r.methodVersion],
            ["Operation", `${r.operation.title} (${r.operation.status})`],
            ["Saved", formatSavedAt(r.savedAt)],
            ["Finished", r.finishedAt ? formatSavedAt(r.finishedAt) : "Not finished"],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="break-all font-mono">{v}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

function RiskPanel({
  run,
  risk,
  responses,
  exportOutput,
}: {
  run: WorkspaceRun;
  risk: AnalysisRisk;
  responses: AnalysisResponse[];
  exportOutput: AnalysisActions["exportOutput"];
}) {
  const [responseId, setResponseId] = useState<string | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<string | null>(risk.forecast.lowPoint.weekStart);
  const response = responses.find((x) => x.id === responseId);
  const shown = response ?? risk;
  return (
    <Panel title={risk.label} testId={`analysis-risk-${risk.id}`}>
      <p className="text-sm">
        Scenario weight:{" "}
        {new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 2 }).format(
          risk.probability,
        )}
        .
      </p>
      <p className="text-xs text-muted-foreground">{risk.probabilityBasis}</p>
      <AnalysisProof
        evidence={risk.evidence}
        description="Source records and assumptions for this hypothetical event."
      />
      {risk.failureReason ? <output className="text-sm">{risk.failureReason}</output> : null}
      <div className="flex flex-wrap gap-2" aria-label="Compare simulated responses">
        <Button
          variant={responseId === null ? "default" : "outline"}
          aria-pressed={responseId === null}
          onClick={() => setResponseId(null)}
          className="h-auto whitespace-normal"
        >
          Show risk without a response
        </Button>
        {responses.map((x) => (
          <Button
            key={x.id}
            variant={responseId === x.id ? "default" : "outline"}
            aria-pressed={responseId === x.id}
            onClick={() => setResponseId(x.id)}
            className="h-auto max-w-full whitespace-normal"
          >
            Preview: {x.label}
          </Button>
        ))}
      </div>
      <p className="text-sm">
        {response ? response.label : "Without a response"}: lowest usable cash is{" "}
        <span className="whitespace-nowrap font-mono">
          {formatExactCents(shown.forecast.lowPoint.usable)}
        </span>{" "}
        in the week of {formatFullDate(shown.forecast.lowPoint.weekStart)}.
      </p>
      <WorkspaceChart
        history={run.baseline.history}
        forecast={shown.forecast}
        parent={response ? risk.forecast : run.forecast}
        items={[]}
        limits={run.constraints.flatMap((c) =>
          c.kind === "min_cash" ? [{ id: c.id, label: c.label, cents: c.limit }] : [],
        )}
        breachedWeeks={shown.receipts.flatMap((x) =>
          x.status === "breached" && x.weekStart ? [x.weekStart] : [],
        )}
        selectedWeek={selectedWeek}
        onSelectWeek={setSelectedWeek}
      />
      <details className="text-xs">
        <summary className="cursor-pointer">Inspect exact weekly cash</summary>
        <ForecastValues forecast={shown.forecast} />
      </details>
      {response ? (
        <div className="space-y-3 rounded-lg border p-3" data-testid="analysis-response">
          <p className="text-sm">
            Low-point change against this risk:{" "}
            <span className="whitespace-nowrap font-mono">{formatDelta(response.gainCents)}</span>.
            Response risk: {response.risk}.
          </p>
          <p className="text-sm">Cost and terms: {response.costNote}</p>
          <p className="text-xs text-muted-foreground">
            {response.clearsAllRules
              ? "The service found no breach in its tested rules. Review individual checks below for scope and unknowns."
              : "This response does not clear every tested rule."}
          </p>
          <AnalysisProof
            evidence={response.evidence}
            description="Source records and assumptions behind this simulated response, including its cost."
          />
        </div>
      ) : null}
      <details className="text-xs">
        <summary className="cursor-pointer">Show simulated event inputs</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          {shown.changes.map((c, i) => (
            <li key={`${i}-${c.kind}`}>{changeText(c, formatExactCents)}</li>
          ))}
        </ul>
      </details>
      <ReceiptsPanel run={{ ...run, receipts: shown.receipts }} />
      {shown.runId ? (
        <div className="space-y-3">
          <Link
            className="text-sm text-primary hover:underline"
            href={workspaceHref(run.companyId, { runId: shown.runId })}
          >
            Open this saved {response ? "response" : "risk"} timeline
          </Link>
          <ExportPanel runId={shown.runId} exportOutput={exportOutput} />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No separate timeline was saved for this result.
        </p>
      )}
    </Panel>
  );
}
function ForecastValues({ forecast }: { forecast: Forecast }) {
  return (
    <div className="mt-2 max-w-full overflow-x-auto">
      <table className="w-full text-left text-xs">
        <caption className="sr-only">Saved usable cash at weekly close</caption>
        <thead>
          <tr>
            <th className="py-2 pr-4">Week of</th>
            <th>Usable cash</th>
          </tr>
        </thead>
        <tbody>
          {forecast.weeks.map((w) => (
            <tr key={w.weekStart}>
              <th className="py-1 pr-4 font-normal whitespace-nowrap">
                {formatFullDate(w.weekStart)}
              </th>
              <td className="whitespace-nowrap font-mono">{formatExactCents(w.usable)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function ExportPanel({
  runId,
  exportOutput,
}: { runId: string; exportOutput: AnalysisActions["exportOutput"] }) {
  const [json, setJson] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  async function load() {
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      const r = await exportOutput(runId);
      if (r.ok) setJson(r.json);
      else setError(r.message);
    } catch {
      setError("The financial output could not be read. Try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="min-w-0 space-y-2 rounded-lg border p-3" data-testid="analysis-output">
      <Button
        variant="outline"
        disabled={pending}
        onClick={load}
        className="h-auto max-w-full whitespace-normal"
      >
        {pending ? "Reading saved output..." : "Read financial output JSON"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Reads saved chart, health and scenario data. No analysis starts.
      </p>
      {error ? (
        <p role="alert" className="text-sm">
          {error}
        </p>
      ) : null}
      {json ? (
        <details open className="min-w-0 text-xs">
          <summary className="cursor-pointer">Inspect the financial output</summary>
          <a
            className="my-2 inline-block text-primary hover:underline"
            href={`data:application/json;charset=utf-8,${encodeURIComponent(json)}`}
            download="timeline-financial-output.json"
          >
            Download financial output
          </a>
          <pre className="max-h-64 max-w-full overflow-auto rounded bg-muted p-2">
            {JSON.stringify(JSON.parse(json), null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
