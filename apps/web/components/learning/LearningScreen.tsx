"use client";
import type { CompanyModel, Evidence } from "@domino/contracts";
import { fixtures } from "@domino/contracts/fixtures";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { formatDate } from "../../lib/format";
import { type GradePreview, LearningChart } from "../LearningChart";
import { ProofDrawer } from "../ProofDrawer";
import { RuleCard } from "../RuleCard";
import { CompanyLoading } from "../company/LiveCompany";
import { isSampleCompany, resolveCompanyId } from "../company/routeId";

export interface WeeklyBriefData {
  week: string;
  text: string;
  evidence: Evidence[];
  at: string;
}
export function WeeklyBrief({ brief }: { brief: WeeklyBriefData | null }) {
  return (
    <section className="space-y-4 rounded-xl bg-card p-5 md:p-6">
      <h2 className="text-base font-medium">Latest weekly brief</h2>
      {brief ? (
        <>
          <p className="text-xs text-muted-foreground">
            Week of {formatDate(brief.week)}, {brief.week.slice(0, 4)}
          </p>
          <p className="max-w-3xl whitespace-pre-line break-words text-sm leading-7">
            {brief.text}
          </p>
          <ProofDrawer
            evidence={brief.evidence}
            description="Records cited in this weekly brief."
          />
        </>
      ) : (
        <p className="break-words text-sm leading-6 text-muted-foreground">
          The weekly brief will appear after a completed week has been processed.
        </p>
      )}
    </section>
  );
}
export function LearningView({
  name,
  model,
  grades,
  brief,
  sample = false,
}: {
  name: string;
  model: CompanyModel | null;
  grades: GradePreview[];
  brief: WeeklyBriefData | null;
  sample?: boolean;
}) {
  const latest = [...grades].sort((a, b) => a.week.localeCompare(b.week)).at(-1);
  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {name}
          {sample ? " · Sample data" : ""}
        </p>
        <h1 className="text-3xl font-medium">
          {latest
            ? `The latest forecast error is ${latest.errorPct}%.`
            : "See what the forecast has learned."}
        </h1>
        <p className="max-w-2xl break-words text-sm leading-6 text-muted-foreground">
          {latest
            ? `Measured for the week of ${formatDate(latest.week)}, ${latest.week.slice(0, 4)}. Compare completed weeks and review the payment rules behind the forecast.`
            : "Weekly results appear when actual records are compared with a forecast. Saved payment patterns are available below."}
        </p>
        {model ? (
          <p className="text-xs text-muted-foreground">Current model version {model.version}</p>
        ) : null}
      </header>
      <section className="space-y-4 rounded-xl bg-card p-5 md:p-6">
        <h2 className="text-base font-medium">Accuracy over time</h2>
        <LearningChart grades={grades} />
      </section>
      <WeeklyBrief brief={brief} />
      <section className="space-y-5">
        <h2 className="text-base font-medium">Saved payment rules</h2>
        {model?.rules.length ? (
          <div className="grid items-start gap-6 xl:grid-cols-2">
            {model.rules.map((rule) => (
              <div key={rule.id} className="rounded-xl bg-card p-5 md:p-6">
                <RuleCard rule={rule} />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No payment rules have been saved yet. They appear after company records are read and
            checked.
          </p>
        )}
      </section>
    </div>
  );
}
function LiveLearning({ companyId }: { companyId: Id<"companies"> }) {
  const company = useQuery(api.companies.get, { companyId });
  const model = useQuery(api.models.latest, { companyId });
  const grades = useQuery(api.grades.list, { companyId });
  const brief = useQuery(api.briefs.latest, { companyId });
  if (company === undefined || model === undefined || grades === undefined || brief === undefined)
    return <CompanyLoading />;
  if (!company)
    return <p className="text-sm">This company could not be found. Check the company link.</p>;
  return <LearningView name={company.name} model={model} grades={grades} brief={brief} />;
}
export function LearningScreen({ companyId }: { companyId: string }) {
  if (isSampleCompany(companyId))
    return (
      <LearningView name="Kestrel Data" model={fixtures.model} grades={[]} brief={null} sample />
    );
  const id = resolveCompanyId(companyId);
  return id.success && process.env.NEXT_PUBLIC_CONVEX_URL ? (
    <LiveLearning companyId={id.data} />
  ) : (
    <p className="text-sm">
      This company link is not available. Check the link or open the sample company.
    </p>
  );
}
