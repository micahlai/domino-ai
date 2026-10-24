"use client";
import type { Branch, Constraint } from "@domino/contracts";
import { fixtures } from "@domino/contracts/fixtures";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { formatCents, formatDate } from "../../lib/format";
import { BranchChart } from "../BranchChart";
import { DominoChain } from "../DominoChain";
import { FixCard } from "../FixCard";
import { ProofDrawer } from "../ProofDrawer";
import { CompanyLoading, LiveFixes } from "../company/LiveCompany";
import { isSampleCompany, resolveCompanyId } from "../company/routeId";
import { matchingFixBranch } from "../company/selection";

export function relatedBranches(branch: Branch, branches: Branch[]) {
  const ids = new Set([branch.id, branch.parentId]);
  return branches.filter(
    (item) =>
      ids.has(item.id) ||
      item.parentId === branch.id ||
      (branch.parentId !== null && item.parentId === branch.parentId),
  );
}
export function BranchDetail({
  branch,
  branches,
  constraints,
  companyPath,
  explanation,
  fixes,
  sample = false,
}: {
  branch: Branch;
  branches: Branch[];
  constraints: Constraint[];
  companyPath: string;
  explanation: string | null;
  fixes: ReactNode;
  sample?: boolean;
}) {
  const related = relatedBranches(branch, branches);
  const minimum = constraints.find((item) => item.kind === "min_cash");
  return (
    <div className="space-y-8">
      <Link className="inline-block min-h-9 text-sm text-primary underline" href={companyPath}>
        Back to cash forecast
      </Link>
      <header className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {sample ? "Sample scenario" : "Saved scenario"} · {branch.status}
        </p>
        <h1 className="text-3xl font-medium">{branch.label}</h1>
        <p className="text-sm text-muted-foreground">
          Cash reaches a low point of {formatCents(branch.forecast.lowPoint.usable)} in the week of{" "}
          {formatDate(branch.forecast.lowPoint.weekStart)},{" "}
          {branch.forecast.lowPoint.weekStart.slice(0, 4)}.
        </p>
      </header>
      <section className="space-y-5 rounded-xl bg-card p-5 md:p-6">
        <h2 className="text-base font-medium">Compare cash forecasts</h2>
        <BranchChart branches={related} selectedId={branch.id} limit={minimum?.limit} />
        {minimum ? (
          <ProofDrawer
            evidence={[minimum.evidence]}
            description="The lender’s requirement used in this comparison."
          />
        ) : null}
        <nav className="flex flex-wrap gap-3" aria-label="Related scenarios">
          {related
            .filter((item) => item.id !== branch.id)
            .map((item) => (
              <Link
                key={item.id}
                className="min-h-9 rounded border px-3 py-2 text-xs hover:bg-muted"
                href={`${companyPath}/branch/${encodeURIComponent(item.id)}`}
              >
                {item.label}
              </Link>
            ))}
        </nav>
      </section>
      <section className="space-y-3">
        <h2 className="text-base font-medium">Why this matters</h2>
        <p className="max-w-3xl whitespace-pre-line text-sm leading-7 text-muted-foreground">
          {explanation ??
            "An explanation has not been saved yet. Review the projected impacts and their source records below."}
        </p>
      </section>
      <div className="grid items-start gap-8 xl:grid-cols-2">
        <section className="space-y-4">
          <h2 className="text-base font-medium">Projected impact</h2>
          {branch.dominoes.length ? (
            <DominoChain dominoes={branch.dominoes} />
          ) : (
            <p className="text-sm text-muted-foreground">
              No detailed impact assessment is saved for this scenario.
            </p>
          )}
        </section>
        <section className="space-y-4">
          <h2 className="text-base font-medium">Proposed fixes</h2>
          {fixes}
        </section>
      </div>
    </div>
  );
}

function BranchContent({
  companyId,
  branch,
  branches,
  constraints,
}: { companyId: Id<"companies">; branch: Branch; branches: Branch[]; constraints: Constraint[] }) {
  const explanation = useQuery(api.explanations.forBranch, { branchId: branch.id });
  const capabilities = useQuery(api.capabilities.get, {});
  const request = useMutation(api.explanations.request);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    if (explanation === null && capabilities?.explain)
      request({ companyId, branchId: branch.id })
        .then((result) => {
          if (active && result.requested)
            setMessage("Preparing an explanation. This page will update when it is ready.");
        })
        .catch(() => {
          if (active)
            setMessage(
              "The explanation could not be requested. Saved forecasts and proof remain available.",
            );
        });
    return () => {
      active = false;
    };
  }, [explanation, capabilities?.explain, request, companyId, branch.id]);
  return (
    <>
      {message && !explanation ? (
        <output className="mb-4 block text-sm text-muted-foreground">{message}</output>
      ) : null}
      <BranchDetail
        branch={branch}
        branches={branches}
        constraints={constraints}
        companyPath={`/c/${companyId}`}
        explanation={explanation ?? null}
        fixes={<LiveFixes branch={branch} branches={branches} />}
      />
    </>
  );
}
function LiveBranch({ companyId, branchId }: { companyId: Id<"companies">; branchId: string }) {
  const company = useQuery(api.companies.get, { companyId });
  const branches = useQuery(api.branches.list, { companyId });
  const constraints = useQuery(api.constraints.list, { companyId });
  if (company === undefined || branches === undefined || constraints === undefined)
    return <CompanyLoading />;
  const branch = branches.find((item) => item.id === branchId);
  if (!company || !branch)
    return (
      <p className="text-sm">
        This scenario could not be found for this company.{" "}
        <Link href={`/c/${companyId}`} className="text-primary underline">
          Return to the cash forecast
        </Link>
        .
      </p>
    );
  return (
    <BranchContent
      key={branch.id}
      companyId={companyId}
      branch={branch}
      branches={branches}
      constraints={constraints}
    />
  );
}
export function BranchScreen({ companyId, branchId }: { companyId: string; branchId: string }) {
  if (isSampleCompany(companyId)) {
    const branch = fixtures.branches.find((item) => item.id === branchId);
    if (!branch) return <p className="text-sm">This sample scenario could not be found.</p>;
    const fixes = fixtures.fixes.filter((fix) => matchingFixBranch(branch, fix, fixtures.branches));
    return (
      <BranchDetail
        branch={branch}
        branches={fixtures.branches}
        constraints={fixtures.constraints}
        companyPath="/c/kestrel"
        explanation={null}
        sample
        fixes={
          fixes.length ? (
            fixes.map((fix) => (
              <FixCard
                key={fix.id}
                fix={fix}
                sample
                simulatedBranch={matchingFixBranch(branch, fix, fixtures.branches)}
                onApprove={async () => undefined}
              />
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No saved fixes for this sample scenario.
            </p>
          )
        }
      />
    );
  }
  const id = resolveCompanyId(companyId);
  return id.success && process.env.NEXT_PUBLIC_CONVEX_URL ? (
    <LiveBranch companyId={id.data} branchId={branchId} />
  ) : (
    <p className="text-sm">
      This company link is not available. Check the company link or open the sample company.
    </p>
  );
}
