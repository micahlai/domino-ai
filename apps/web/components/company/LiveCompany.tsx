"use client";

import { AddEventDialog } from "@/components/AddEventDialog";
import { FixCard } from "@/components/FixCard";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { Branch } from "@domino/contracts";
import { useConvexConnectionState, useMutation, useQuery } from "convex/react";
import { LiveConnection } from "../flows/ConnectScreen";
import { NextWeekDialog } from "../flows/NextWeekDialog";
import { CompanyWorkspace } from "./CompanyWorkspace";
import { matchingFixBranch } from "./selection";

export function CompanyConnectionStatus() {
  const connection = useConvexConnectionState();
  if (connection.isWebSocketConnected || !connection.connectionRetries) return null;
  return (
    <output className="mb-4 block rounded-lg bg-secondary p-4 text-sm text-muted-foreground">
      {connection.hasEverConnected
        ? "Reconnecting to company records. Saved results may be out of date."
        : "Could not connect to company records yet. Retrying automatically…"}
    </output>
  );
}

export function CompanyLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <p className="text-sm text-muted-foreground">Loading company records and cash forecasts…</p>
      <Skeleton className="h-12 w-3/4" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-[420px] w-full" />
    </div>
  );
}

export function LiveFixes({ branch, branches }: { branch: Branch; branches: Branch[] }) {
  const candidates = useQuery(api.fixes.forBranch, { branchId: branch.id });
  const capabilities = useQuery(api.capabilities.get, {});
  const simulate = useMutation(api.fixes.simulate);
  const decide = useMutation(api.approvals.decide);
  if (candidates === undefined)
    return (
      <div aria-busy="true" className="space-y-3">
        <p className="text-sm text-muted-foreground">Loading proposed fixes for this scenario…</p>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  if (!candidates.length)
    return (
      <p className="text-sm text-muted-foreground">No fixes have been saved for this scenario.</p>
    );
  return (
    <div className="space-y-4">
      {candidates.map(({ fix, gain }) => {
        const saved = matchingFixBranch(branch, fix, branches);
        return (
          <FixCard
            key={fix.id}
            fix={fix}
            gain={gain}
            simulatedBranch={saved}
            onSimulate={
              capabilities?.simulate
                ? async () => {
                    await simulate({ branchId: branch.id, fixId: fix.id });
                  }
                : undefined
            }
            onApprove={
              saved
                ? async () => {
                    await decide({ branchId: saved.id, fixId: fix.id, decision: "approved" });
                  }
                : undefined
            }
          />
        );
      })}
    </div>
  );
}

export function LiveCompany({ companyId }: { companyId: Id<"companies"> }) {
  const company = useQuery(api.companies.get, { companyId });
  const report = useQuery(api.resilience.get, { companyId, withFixes: false });
  const reportWithFixes = useQuery(api.resilience.get, { companyId, withFixes: true });
  const history = useQuery(api.history.get, { companyId });
  const constraints = useQuery(api.constraints.list, { companyId });
  const risks = useQuery(api.risks.list, { companyId });
  const branches = useQuery(api.branches.list, { companyId });
  const capabilities = useQuery(api.capabilities.get, {});
  const inputs = useQuery(api.eventInputs.get, { companyId });
  const addEvent = useMutation(api.events.add);
  const nextWeek = useMutation(api.week.next);
  if (
    company === undefined ||
    report === undefined ||
    reportWithFixes === undefined ||
    history === undefined ||
    constraints === undefined ||
    risks === undefined ||
    branches === undefined ||
    capabilities === undefined ||
    inputs === undefined
  )
    return <CompanyLoading />;
  if (!company)
    return (
      <p className="text-sm text-muted-foreground">
        This company could not be found. Check the company link.
      </p>
    );
  if (company.status === "connecting") return <LiveConnection companyId={companyId} />;
  if (!report || !reportWithFixes || !history)
    return (
      <div className="space-y-3">
        <h1 className="text-3xl font-medium">{company.name} is getting ready.</h1>
        <output className="text-sm text-muted-foreground">
          The forecast will appear when company records have been processed.
        </output>
      </div>
    );
  return (
    <div className="space-y-4">
      <CompanyWorkspace
        data={{ company, history, report, reportWithFixes, constraints, risks, branches }}
        companyPath={`/c/${companyId}`}
        actions={
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <AddEventDialog
                key={`${inputs?.asOf ?? company.today}:${report.universes.map((future) => future.id).join("|")}`}
                risks={risks}
                inputs={inputs ?? undefined}
                unavailableReason="New forecasts cannot be computed yet. You can configure and review an event here."
                onAdd={
                  capabilities.addEvent
                    ? async (risk) => {
                        await addEvent({ companyId, label: risk.label, changes: risk.changes });
                      }
                    : undefined
                }
              />
              <NextWeekDialog
                currentWeek={company.currentWeek}
                onAdvance={
                  capabilities.nextWeek
                    ? async () => {
                        await nextWeek({ companyId });
                      }
                    : undefined
                }
              />
            </div>
            <p className="max-w-xs text-xs text-muted-foreground">
              New events and weeks are not available yet. Review the saved forecasts below.
            </p>
          </div>
        }
        renderFixes={(branch) => <LiveFixes key={branch.id} branch={branch} branches={branches} />}
      />
    </div>
  );
}
