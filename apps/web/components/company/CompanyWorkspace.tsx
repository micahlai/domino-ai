"use client";

import { DominoChain } from "@/components/DominoChain";
import { Headline } from "@/components/Headline";
import { MultiverseTimeline } from "@/components/MultiverseTimeline";
import { ProofDrawer } from "@/components/ProofDrawer";
import { ResilienceBar } from "@/components/ResilienceBar";
import { RiskList } from "@/components/RiskList";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import type {
  Branch,
  Constraint,
  HistoryWeek,
  PastEvent,
  ResilienceReport,
  RiskEvent,
} from "@domino/contracts";
import { type ReactNode, useState } from "react";
import { matchingEventBranch, weekOf } from "./selection";

export interface WorkspaceData {
  company: { name: string; today: string };
  history: { weeks: HistoryWeek[]; pastEvents: PastEvent[] };
  report: ResilienceReport;
  reportWithFixes: ResilienceReport;
  constraints: Constraint[];
  risks: RiskEvent[];
  branches: Branch[];
}

export function CompanyWorkspace({
  data,
  sample = false,
  actions,
  renderFixes,
}: {
  data: WorkspaceData;
  sample?: boolean;
  actions: ReactNode;
  renderFixes: (branch: Branch) => ReactNode;
}) {
  const [showFixes, setShowFixes] = useState(false);
  const [selectedKey, setSelectedKey] = useState(
    data.report.universes
      .find((future) => future.riskIds.length === 1)
      ?.riskIds.slice()
      .sort()
      .join("|"),
  );
  const report = showFixes ? data.reportWithFixes : data.report;
  const future = report.universes.find(
    (entry) => entry.riskIds.slice().sort().join("|") === selectedKey,
  );
  const branch = future ? matchingEventBranch(future, data.risks, data.branches) : undefined;
  const limit = data.constraints.find((constraint) => constraint.kind === "min_cash");
  const proof = [
    ...data.constraints.map((constraint) => constraint.evidence),
    ...data.risks.flatMap((risk) => risk.evidence),
  ];
  function select(id: string) {
    setSelectedKey(
      report.universes
        .find((entry) => entry.id === id)
        ?.riskIds.slice()
        .sort()
        .join("|"),
    );
  }
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-sm font-medium">
            {data.company.name}{" "}
            <Badge variant="secondary" className="ml-2 font-normal">
              {sample ? "Sample data" : "Company records"}
            </Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Week of {formatDate(weekOf(data.company.today))} · As of{" "}
            {formatDate(data.company.today)}, {data.company.today.slice(0, 4)}
          </p>
        </div>
        {actions}
      </div>
      <div>
        <Headline
          text={`${data.company.name} survives ${report.survivedCount} of ${report.universes.length} possible futures.`}
        />
        <p className="mt-3 text-sm text-muted-foreground">
          Explore the next 13 weeks. Choose a future to follow the chain and review your options.
        </p>
      </div>
      <section aria-label="Resilience" className="rounded-xl bg-card p-5 md:p-6">
        <ResilienceBar
          report={data.report}
          reportWithFixes={data.reportWithFixes}
          showFixes={showFixes}
          onToggle={setShowFixes}
        />
        <div className="mt-4">
          <ProofDrawer
            evidence={proof}
            description={
              sample
                ? "Sample records behind this forecast."
                : "Source records and constraints used in this forecast."
            }
          />
        </div>
      </section>
      <section aria-label="Cash timeline" className="rounded-xl bg-card p-5 md:p-6">
        {limit && report.universes.length ? (
          <MultiverseTimeline
            history={data.history.weeks}
            pastEvents={data.history.pastEvents}
            today={data.company.today}
            report={report}
            comparisonReport={showFixes ? data.report : data.reportWithFixes}
            limit={limit.limit}
            selectedUniverseId={future?.id}
            onSelectUniverse={select}
            showFixes={showFixes}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            The cash timeline will appear when the forecast and lender’s limit are ready.
          </p>
        )}
      </section>
      <div className="grid items-start gap-8 xl:grid-cols-[0.85fr_1fr_1.2fr]">
        <section aria-labelledby="risks-title" className="min-w-0 space-y-4">
          <h2 id="risks-title" className="text-base font-medium">
            What could happen
          </h2>
          <p className="text-xs text-muted-foreground">Ranked risks for the 13-week view.</p>
          {data.risks.length ? (
            <RiskList
              risks={data.risks}
              selectedId={future?.riskIds.length === 1 ? future.riskIds[0] : undefined}
              onSelect={(id) => {
                const match = report.universes.find(
                  (entry) => entry.riskIds.length === 1 && entry.riskIds[0] === id,
                );
                if (match) select(match.id);
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">No risks have been identified yet.</p>
          )}
        </section>
        <section aria-labelledby="chain-title" className="min-w-0 space-y-5">
          <div>
            <h2 id="chain-title" className="text-base font-medium">
              Follow the chain
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {future?.label ?? "Choose a possible future."}
            </p>
          </div>
          {showFixes ? (
            <p className="text-xs text-primary">
              The chart previews fixes. This chain shows the original event.
            </p>
          ) : null}
          {branch ? (
            branch.dominoes.length ? (
              <DominoChain dominoes={branch.dominoes} />
            ) : (
              <p className="text-sm text-muted-foreground">
                No chain reaction is recorded for this future.
              </p>
            )
          ) : (
            <p className="text-sm text-muted-foreground">
              {future
                ? "This combination has a forecast, but no detailed chain or fixes have been saved yet."
                : "Select a future on the chart to explore its chain."}
            </p>
          )}
        </section>
        <section aria-labelledby="fixes-title" className="min-w-0 space-y-4">
          <h2 id="fixes-title" className="text-base font-medium">
            Ways to change the outcome
          </h2>
          {branch ? (
            renderFixes(branch)
          ) : (
            <p className="text-sm text-muted-foreground">
              Fixes will appear when a detailed future is available.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
