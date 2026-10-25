"use client";

import type { Change, Constraint, WeeklyResultRefV1 } from "@domino/contracts";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "../../ui/badge";
import { formatExactCents, formatSavedAt } from "../baseline/format";
import { AncestryPanel } from "./CatalogPanel";
import { EventForm } from "./EventForm";
import { type QuestionActions, QuestionsPanel } from "./QuestionsPanel";
import { RuleEditor } from "./RuleEditor";
import {
  ChangesPanel,
  ComparisonPanel,
  ImpactPanel,
  ReceiptsPanel,
  WeekDetail,
  WhenDate,
} from "./RunPanels";
import { WorkspaceChart } from "./WorkspaceChart";
import type { CatalogEntry, QuestionReceipt, Read, WorkspaceRun } from "./api";
import { eventFromItem, eventOptions } from "./drafts";
import type { Outcome } from "./requests";

export type WorkspaceActions = QuestionActions & {
  reviseRules: (constraints: Constraint[], note: string) => Promise<Outcome>;
  simulate: (label: string, changes: Change[]) => Promise<Outcome>;
  catalogHref: string;
};

export type WorkspaceViewProps = {
  run: WorkspaceRun;
  parent: Read<WorkspaceRun> | null;
  graph: Read<CatalogEntry[]>;
  questions: Read<QuestionReceipt[]>;
  resultRef: Read<WeeklyResultRefV1>;
  actions: WorkspaceActions;
  /** Why writes are unavailable here (for example a fixture or no service connection). */
  disabled?: string;
};

const KIND = { baseline: "Imported baseline", rules: "Rules changed", scenario: "Scenario" };

/** One saved scenario, interactive. Props only; every number comes from the saved record. */
export function WorkspaceView({
  run,
  parent,
  graph,
  questions,
  resultRef,
  actions,
  disabled,
}: WorkspaceViewProps) {
  const b = run.baseline;
  const low = run.forecast.lowPoint;
  const [selectedWeek, setSelectedWeek] = useState<string | null>(low.weekStart);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const options = useMemo(() => eventOptions(b.seed), [b.seed]);
  const suggestion = useMemo(() => {
    const item = b.seed.scheduledItems.find((i) => i.id === selectedItemId);
    return item ? eventFromItem(item, options) : undefined;
  }, [b.seed, selectedItemId, options]);
  const parentForecast = parent?.state === "ready" ? parent.value.forecast : null;
  const limits = run.constraints.flatMap((c) =>
    c.kind === "min_cash" && Number.isSafeInteger(c.limit)
      ? [{ id: c.id, label: c.label, cents: c.limit }]
      : [],
  );
  const firstWeek = run.forecast.weeks[0]?.weekStart ?? b.seed.asOf;

  return (
    <article
      className="min-w-0 max-w-full space-y-6 [overflow-wrap:anywhere]"
      data-testid="workspace"
      data-run-id={run.runId}
    >
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Link
            href={actions.catalogHref}
            className="text-primary underline-offset-4 hover:underline"
          >
            All saved scenarios
          </Link>
          <Badge variant="outline">{KIND[run.kind]}</Badge>
          <span>Saved {formatSavedAt(run.savedAt)}, read only</span>
        </div>
        <h2 className="text-2xl font-medium" data-testid="workspace-headline">
          {run.label ? `${run.label}: ` : ""}
          {b.companyName}&rsquo;s usable cash is lowest in the week of{" "}
          <WhenDate iso={low.weekStart} />, at {formatExactCents(low.usable)}
        </h2>
        {parent && parent.state !== "ready" ? (
          <p className="text-xs text-muted-foreground" data-testid="parent-unavailable">
            {parent.state === "loading"
              ? "Reading the scenario it started from..."
              : "The scenario it started from could not be shown, so it is not drawn."}
          </p>
        ) : null}
      </header>

      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="min-w-0 max-w-full space-y-6 lg:col-span-2">
          <WorkspaceChart
            history={b.history}
            forecast={run.forecast}
            parent={parentForecast}
            items={b.seed.scheduledItems}
            limits={limits}
            breachedWeeks={run.receipts.flatMap((receipt) =>
              receipt.status === "breached" && receipt.weekStart ? [receipt.weekStart] : [],
            )}
            selectedWeek={selectedWeek}
            onSelectWeek={(w) => {
              setSelectedWeek(w);
              setSelectedItemId(null);
            }}
          />
          <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
            <WeekDetail
              run={run}
              weekStart={selectedWeek}
              selectedItemId={selectedItemId}
              onSelectItem={setSelectedItemId}
            />
            <ComparisonPanel run={run} />
            <ReceiptsPanel run={run} />
            <ImpactPanel dominoes={run.dominoes} />
            <ChangesPanel run={run} />
            <AncestryPanel graph={graph} runId={run.runId} hrefFor={actions.hrefFor} />
          </div>
          <Provenance run={run} resultRef={resultRef} />
        </div>
        <div className="min-w-0 max-w-full space-y-6">
          <QuestionsPanel
            questions={questions}
            selectedWeek={selectedWeek}
            selectedItemId={selectedItemId}
            onClearContext={() => {
              setSelectedWeek(null);
              setSelectedItemId(null);
            }}
            actions={actions}
            disabled={disabled}
          />
          <EventForm
            firstWeek={firstWeek}
            invoices={options.invoices}
            bills={options.bills}
            suggestion={suggestion}
            onRun={actions.simulate}
            disabled={disabled}
          />
          <RuleEditor
            constraints={run.constraints}
            bills={options.bills}
            onSave={actions.reviseRules}
            disabled={disabled}
          />
        </div>
      </div>
    </article>
  );
}

function Provenance({ run, resultRef }: { run: WorkspaceRun; resultRef: Read<WeeklyResultRefV1> }) {
  return (
    <details className="rounded-lg border p-4 text-xs" data-testid="provenance">
      <summary className="cursor-pointer text-sm">Where this came from</summary>
      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
        {(
          [
            ["Saved scenario", run.runId],
            ["Started from", run.parentRunId ?? "Nothing: this is the imported baseline"],
            ["Imported baseline", run.baselineRunId],
            ["Weekly seed", `${run.baseline.seed.id} (${run.baseline.seedHash})`],
            ["Inputs fingerprint", run.inputHash],
            ["Method", run.methodVersion],
            ["Rules version", run.constraintVersion],
            ["Rules note", run.constraintNote || "None"],
            ["Operation", `${run.operation.title} (${run.operation.status})`],
          ] as const
        ).map(([k, v]) => (
          <div key={k}>
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="break-all font-mono">{v}</dd>
          </div>
        ))}
        <div>
          <dt className="text-muted-foreground">Result pointer</dt>
          <dd className="break-all font-mono" data-testid="result-ref">
            {resultRef.state === "ready"
              ? `${resultRef.value.kind} ${resultRef.value.route}`
              : resultRef.state === "loading"
                ? "Reading..."
                : resultRef.state === "missing"
                  ? "None saved"
                  : "Could not be shown"}
          </dd>
        </div>
      </dl>
    </details>
  );
}
