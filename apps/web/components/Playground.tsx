"use client";

import { AddEventDialog } from "@/components/AddEventDialog";
import { BranchChart } from "@/components/BranchChart";
import { ConnectChecklist, type SourcePreview } from "@/components/ConnectChecklist";
import { DominoChain } from "@/components/DominoChain";
import { FixCard } from "@/components/FixCard";
import { Headline } from "@/components/Headline";
import { LearningChart } from "@/components/LearningChart";
import { MultiverseTimeline } from "@/components/MultiverseTimeline";
import { ProofDrawer } from "@/components/ProofDrawer";
import { ResilienceBar } from "@/components/ResilienceBar";
import { RiskList } from "@/components/RiskList";
import { RuleCard } from "@/components/RuleCard";
import { FixtureCompany } from "@/components/company/FixtureCompany";
import { ParticleMotionPreview } from "@/components/multiverse/ParticleMotionPreview";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDate } from "@/lib/format";
import { fixtures } from "@domino/contracts/fixtures";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { BranchDetail } from "./flows/BranchDetail";
import { ConnectForm, ConnectionProgress } from "./flows/ConnectScreen";
import { NextWeekDialog } from "./flows/NextWeekDialog";
import { LearningPreview } from "./learning/LearningPreview";
import { LearningView } from "./learning/LearningScreen";
import { RecordView } from "./records/RecordScreen";

const sections = [
  "CompanyWorkspace",
  "Headline",
  "ResilienceBar",
  "MultiverseTimeline",
  "ParticleMotion",
  "RiskList",
  "DominoChain",
  "FixCard",
  "ProofDrawer",
  "BranchChart",
  "ConnectChecklist",
  "LearningChart",
  "RuleCard",
  "AddEventDialog",
  "ConnectionFlow",
  "BranchDetail",
  "NextWeek",
  "LearningScreen",
  "WeeklyBrief",
  "DecisionRecord",
];
const sources: SourcePreview[] = [
  ...fixtures.risks.flatMap((risk) => risk.evidence),
  ...fixtures.constraints.map((constraint) => constraint.evidence),
]
  .filter(
    (source, index, all) =>
      all.findIndex((candidate) => candidate.source === source.source) === index,
  )
  .map((evidence) => ({
    kind: evidence.source,
    label: {
      stripe: "Billing records",
      learned: "Learned payment patterns",
      crm: "Customer records",
      document: "Company documents",
      nessie: "Bank records",
      ramp: "Card spending",
      books: "Accounting records",
      payroll: "Payroll records",
    }[evidence.source],
    status: "found",
  }));

function PreviewSection({
  name,
  description,
  children,
  className,
}: { name: string; description: string; children: ReactNode; className?: string }) {
  return (
    <Card
      id={name}
      className={className ? `scroll-mt-8 shadow-none ${className}` : "scroll-mt-8 shadow-none"}
    >
      <CardHeader>
        <CardTitle className="text-sm font-medium">{name}</CardTitle>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function Playground() {
  const [showFixes, setShowFixes] = useState(false);
  const [selectedFutureKey, setSelectedFutureKey] = useState<string>();
  const [selectedRiskId, setSelectedRiskId] = useState(fixtures.risks[0]?.id);
  const report = showFixes ? fixtures.resilienceWithFixes : fixtures.resilience;
  const selectedFuture = report.universes.find(
    (future) => [...future.riskIds].sort().join("|") === selectedFutureKey,
  );
  const eventBranch = fixtures.branches.find((branch) => branch.id === "br_acme_late");
  const limit =
    fixtures.constraints.find((constraint) => constraint.kind === "min_cash")?.limit ?? 0;
  const rule = fixtures.model.rules[0];
  const evidence = fixtures.constraints.map((constraint) => constraint.evidence);
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Workspace</span>
          <span aria-hidden="true">/</span>
          <span className="text-foreground">Playground</span>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge tabIndex={0} variant="secondary" className="cursor-help px-3 py-1.5 font-normal">
              Kestrel Data · sample data
            </Badge>
          </TooltipTrigger>
          <TooltipContent>Shared contract fixtures. No company data is changed.</TooltipContent>
        </Tooltip>
      </div>
      <div id="Headline" className="scroll-mt-8">
        <p className="mb-3 text-sm font-medium text-primary">Build with a clear view.</p>
        <Headline text="A place to see every piece come together." />
        <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
          The foundations of Domino, using Kestrel’s sample records. Review each component here
          before it becomes part of the company’s forecast.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <span className="text-muted-foreground">
          As of {formatDate(fixtures.snapshot.asOf)}, 2026
        </span>
        <span className="hidden h-4 border-l sm:block" aria-hidden="true" />
        <Link
          href="/c/kestrel"
          className="inline-flex min-h-11 items-center gap-1 rounded text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Open company shell
          <ArrowUpRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
      <Separator />
      <nav aria-label="Component previews" className="flex flex-wrap gap-2">
        {sections.map((name) => (
          <a
            key={name}
            href={`#${name}`}
            className="inline-flex min-h-9 items-center rounded-lg border px-3 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {name}
          </a>
        ))}
      </nav>
      <PreviewSection
        name="CompanyWorkspace"
        description="The assembled main screen. Sample approvals only; no records change."
      >
        <FixtureCompany />
      </PreviewSection>
      <PreviewSection
        name="ResilienceBar"
        description="The share of forecast scenarios that meet cash requirements."
      >
        <ResilienceBar
          report={fixtures.resilience}
          reportWithFixes={fixtures.resilienceWithFixes}
          showFixes={showFixes}
          onToggle={setShowFixes}
        />
      </PreviewSection>
      <PreviewSection
        name="MultiverseTimeline"
        description="Recorded cash on the left. Forecast scenarios on the right."
      >
        <MultiverseTimeline
          history={fixtures.history}
          pastEvents={fixtures.pastEvents}
          today={fixtures.snapshot.asOf}
          report={report}
          comparisonReport={showFixes ? fixtures.resilience : fixtures.resilienceWithFixes}
          selectedUniverseId={selectedFuture?.id}
          onSelectUniverse={(id) =>
            setSelectedFutureKey(
              report.universes
                .find((future) => future.id === id)
                ?.riskIds.slice()
                .sort()
                .join("|"),
            )
          }
          showFixes={showFixes}
          limit={limit}
        />
      </PreviewSection>
      <PreviewSection
        name="ParticleMotion"
        description="Motion stress preview: 30 copies of sample forecast paths, not new financial scenarios."
      >
        <ParticleMotionPreview />
      </PreviewSection>
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <PreviewSection
          name="RiskList"
          description="Select a sample risk to preview its selection state."
        >
          <RiskList
            risks={fixtures.risks}
            selectedId={selectedRiskId}
            onSelect={setSelectedRiskId}
          />
        </PreviewSection>
        <PreviewSection
          name="DominoChain"
          description="The projected cash impact of Acme paying late."
        >
          <DominoChain dominoes={eventBranch?.dominoes ?? []} />
        </PreviewSection>
        <PreviewSection name="FixCard" description="Try a change before a person decides to act.">
          <div className="space-y-4">
            {fixtures.fixes.map((fix) => (
              <FixCard key={fix.id} fix={fix} />
            ))}
          </div>
        </PreviewSection>
        <PreviewSection
          name="ProofDrawer"
          description="Read the source behind the lender’s limit and runway policy."
        >
          <p className="mb-5 text-sm leading-6 text-muted-foreground">
            Every forecast should have a trail back to the records. Open the sample loan agreement
            and board policy.
          </p>
          <ProofDrawer evidence={evidence} />
        </PreviewSection>
        <PreviewSection
          name="BranchChart"
          description="Sample low points for comparing cash scenarios."
        >
          <BranchChart branches={fixtures.branches} limit={limit} />
        </PreviewSection>
        <PreviewSection
          name="ConnectChecklist"
          description="Sources found in the sample billing, customer and document records."
        >
          <ConnectChecklist sources={sources} />
        </PreviewSection>
        <PreviewSection
          name="LearningChart"
          description="Illustrative chart values for reviewing the layout; these are not measured company results."
        >
          <LearningChart
            grades={[
              { week: "2026-10-12", errorPct: 6.1 },
              { week: "2026-10-19", errorPct: 6.8 },
              { week: "2026-10-26", errorPct: 3.4 },
            ]}
          />
        </PreviewSection>
        <PreviewSection
          name="RuleCard"
          description="A payment pattern learned from the fixture records."
        >
          {rule ? <RuleCard rule={rule} /> : <p className="text-sm">No learned rules yet.</p>}
        </PreviewSection>
        <PreviewSection
          name="AddEventDialog"
          description="Preview event selection without changing the forecast."
        >
          <AddEventDialog
            risks={fixtures.risks}
            inputs={{
              asOf: fixtures.snapshot.asOf,
              customers: fixtures.snapshot.customers,
              invoices: fixtures.snapshot.invoices,
            }}
          />
        </PreviewSection>
      </div>
      <PreviewSection
        name="ConnectionFlow"
        description="Company form and source progress preview; no company records change."
      >
        <ConnectForm />
        <div className="mt-8">
          <ConnectionProgress
            name="Sample company"
            ready={false}
            processingReady
            sources={[
              {
                kind: "stripe",
                label: "Billing records",
                status: "learned",
                step: "Invoice fields mapped",
              },
              {
                kind: "nessie",
                label: "Demo bank",
                status: "checked",
                step: "Cash checked against bank records",
              },
              {
                kind: "crm",
                label: "Customer records",
                status: "needs_review",
                step: "Review one unmatched customer",
              },
            ]}
          />
        </div>
      </PreviewSection>
      <PreviewSection
        name="BranchDetail"
        description="Saved scenario comparison, projected impact and proof."
      >
        {eventBranch ? (
          <BranchDetail
            branch={eventBranch}
            branches={fixtures.branches}
            constraints={fixtures.constraints}
            companyPath="/c/kestrel"
            explanation={null}
            sample
            fixes={
              <p className="text-sm text-muted-foreground">
                Review saved fix cards in the main screen preview.
              </p>
            }
          />
        ) : null}
      </PreviewSection>
      <PreviewSection
        name="NextWeek"
        description="Confirmation preview. Preparing new weeks requires the live processing service."
      >
        <NextWeekDialog currentWeek={0} />
      </PreviewSection>
      <PreviewSection
        name="LearningScreen"
        description="Saved payment rules and honest empty accuracy results for the sample company."
      >
        <LearningView name="Kestrel Data" model={fixtures.model} grades={[]} brief={null} sample />
      </PreviewSection>
      <PreviewSection
        name="WeeklyBrief"
        description="Illustrative weekly notification preview; no generated company brief is saved."
      >
        <LearningPreview />
      </PreviewSection>
      <PreviewSection
        name="DecisionRecord"
        description="Illustrative decision and activity rows, for layout and reference navigation only."
      >
        <RecordView
          name="Illustrative company"
          sample
          companyPath="/c/kestrel"
          branches={fixtures.branches}
          approvals={[
            {
              fixId: "fix_early_pay",
              branchId: "br_fix_early_pay",
              decision: "approved",
              by: "Sample reviewer",
              at: "2026-10-30T17:00:00Z",
              note: "Illustrative decision; no company approval was recorded.",
            },
          ]}
          activity={[
            {
              actor: "person",
              action: "fix.approved",
              refs: ["fix_early_pay", "br_fix_early_pay"],
              at: "2026-10-30T17:00:00Z",
            },
          ]}
        />
      </PreviewSection>
      <p className="pb-4 text-sm text-muted-foreground">
        Component previews only. Sample actions do not change company records.
      </p>
    </div>
  );
}
