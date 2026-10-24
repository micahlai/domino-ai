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
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDate } from "@/lib/format";
import { fixtures } from "@domino/contracts/fixtures";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";

const sections = [
  "Headline",
  "ResilienceBar",
  "MultiverseTimeline",
  "RiskList",
  "DominoChain",
  "FixCard",
  "ProofDrawer",
  "BranchChart",
  "ConnectChecklist",
  "LearningChart",
  "RuleCard",
  "AddEventDialog",
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
        name="ResilienceBar"
        description="A quick answer to how many possible futures survive."
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
        description="History on the left. Possible futures on the right."
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
        <PreviewSection name="DominoChain" description="The chain caused by Acme paying late.">
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
          description="Fixture low points for the chart that will compare futures."
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
          description="The empty state before weekly results are available."
        >
          <LearningChart grades={[]} />
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
          <AddEventDialog risks={fixtures.risks} />
        </PreviewSection>
      </div>
      <p className="pb-4 text-sm text-muted-foreground">
        Component previews only. The next product tasks add interactive charts, live data and
        approval flows.
      </p>
    </div>
  );
}
