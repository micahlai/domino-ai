"use client";
import type { Branch } from "@domino/contracts";
import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ProofDrawer } from "../ProofDrawer";
import { CompanyLoading } from "../company/LiveCompany";
import { isSampleCompany, resolveCompanyId } from "../company/routeId";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";

export interface ApprovalEntry {
  fixId: string;
  branchId: string;
  decision: "approved" | "rejected";
  by: string;
  at: string;
  note: string;
}
export interface ActivityEntry {
  actor: string;
  action: string;
  refs: string[];
  at: string;
}
const calendar = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Los_Angeles",
});
const actorLabels: Record<string, string> = {
  person: "Person",
  engine: "Forecast service",
  "agent:creao": "Learning assistant",
  "agent:claude": "Planning assistant",
  connector: "Data connection",
};
const actionLabels: Record<string, string> = {
  "fixtures.seed": "Sample records loaded",
  "fix.approved": "Proposed fix approved",
  "fix.rejected": "Proposed fix rejected",
  "week.advance": "Next week prepared",
  "company.created": "Company created",
  "events.add": "New event requested",
};
function References({
  refs,
  branches,
  companyPath,
}: { refs: string[]; branches: Branch[]; companyPath: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="min-h-9">
          View references
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>References in this entry</DialogTitle>
          <DialogDescription>
            These are the saved references attached to this decision or activity.
          </DialogDescription>
        </DialogHeader>
        {refs.length ? (
          <ul className="space-y-3 text-sm">
            {[...new Set(refs)].map((ref) => {
              const branch = branches.find((branch) => branch.id === ref);
              return (
                <li key={ref} className="break-all">
                  {branch ? (
                    <Link
                      className="text-primary underline"
                      href={`${companyPath}/branch/${encodeURIComponent(branch.id)}`}
                    >
                      {branch.label}
                    </Link>
                  ) : (
                    ref
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No references were attached.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
export function RecordView({
  name,
  approvals,
  activity,
  branches,
  companyPath,
  sample = false,
}: {
  name: string;
  approvals: ApprovalEntry[];
  activity: ActivityEntry[];
  branches: Branch[];
  companyPath: string;
  sample?: boolean;
}) {
  const decisions = [...approvals].sort((a, b) => b.at.localeCompare(a.at));
  const events = [...activity].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {name}
          {sample ? " · Sample data" : ""}
        </p>
        <h1 className="text-3xl font-medium">Every decision has a record.</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Review who decided, what changed and the records behind it. Newest entries appear first.
          Times are shown in Pacific time.
        </p>
      </header>
      <section className="space-y-4">
        <h2 className="text-base font-medium">Decisions</h2>
        {decisions.length ? (
          <p className="text-xs text-muted-foreground sm:hidden">
            Swipe the table to see all columns.
          </p>
        ) : null}
        {decisions.length ? (
          <div className="overflow-x-auto rounded-xl bg-card">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Recorded decisions, newest first</caption>
              <thead>
                <tr>
                  {["Plan and decision", "Who", "When", "Records"].map((label) => (
                    <th className="px-5 py-4 font-medium" key={label}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {decisions.map((entry, index) => {
                  const branch = branches.find((branch) => branch.id === entry.branchId);
                  const evidence = branch?.dominoes.flatMap((step) => step.evidence) ?? [];
                  return (
                    <tr key={`${entry.at}:${entry.fixId}:${index}`} className="border-t">
                      <td className="min-w-64 px-5 py-4">
                        <p>{branch?.label ?? "Saved proposed fix"}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {entry.decision === "approved" ? "Approved" : "Rejected"} · Decision only;
                          no action executed
                        </p>
                        {entry.note ? (
                          <p className="mt-2 text-xs text-muted-foreground">{entry.note}</p>
                        ) : null}
                      </td>
                      <td className="min-w-44 break-words px-5 py-4 text-muted-foreground">
                        {entry.by === "demo-user (unverified)"
                          ? "Demo user (unverified)"
                          : entry.by}
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 text-xs text-muted-foreground">
                        <time dateTime={entry.at}>{calendar.format(new Date(entry.at))}</time>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap gap-2">
                          <References
                            refs={[entry.fixId, entry.branchId]}
                            branches={branches}
                            companyPath={companyPath}
                          />
                          {evidence.length ? <ProofDrawer evidence={evidence} /> : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-xl bg-card p-5 text-sm text-muted-foreground">
            No decisions have been recorded yet.{" "}
            <Link className="text-primary underline" href={companyPath}>
              Review a saved fix
            </Link>{" "}
            before approving it.
          </div>
        )}
      </section>
      <section className="space-y-4">
        <h2 className="text-base font-medium">Activity</h2>
        {events.length ? (
          <p className="text-xs text-muted-foreground sm:hidden">
            Swipe the table to see all columns.
          </p>
        ) : null}
        {events.length === 200 ? (
          <p className="text-xs text-muted-foreground">
            Showing the latest 200 saved activity entries.
          </p>
        ) : null}
        {events.length ? (
          <div className="overflow-x-auto rounded-xl bg-card">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Company activity, newest first</caption>
              <thead>
                <tr>
                  {["What happened", "Who", "When", "Records"].map((label) => (
                    <th className="px-5 py-4 font-medium" key={label}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map((entry, index) => (
                  <tr key={`${entry.at}:${entry.action}:${index}`} className="border-t">
                    <td className="min-w-48 px-5 py-4">
                      {actionLabels[entry.action] ?? entry.action.replace(/[._:-]/g, " ")}
                    </td>
                    <td className="px-5 py-4 text-muted-foreground">
                      {actorLabels[entry.actor] ?? entry.actor}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-xs text-muted-foreground">
                      <time dateTime={entry.at}>{calendar.format(new Date(entry.at))}</time>
                    </td>
                    <td className="px-5 py-4">
                      <References refs={entry.refs} branches={branches} companyPath={companyPath} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No activity has been recorded yet. Entries appear as company records are processed.
          </p>
        )}
      </section>
    </div>
  );
}
function LiveRecord({ companyId }: { companyId: Id<"companies"> }) {
  const company = useQuery(api.companies.get, { companyId });
  const approvals = useQuery(api.approvals.list, { companyId });
  const activity = useQuery(api.log.list, { companyId, limit: 200 });
  const branches = useQuery(api.branches.list, { companyId });
  if (
    company === undefined ||
    approvals === undefined ||
    activity === undefined ||
    branches === undefined
  )
    return <CompanyLoading />;
  if (!company)
    return <p className="text-sm">This company could not be found. Check the company link.</p>;
  return (
    <RecordView
      name={company.name}
      approvals={approvals}
      activity={activity}
      branches={branches}
      companyPath={`/c/${companyId}`}
    />
  );
}
export function RecordScreen({ companyId }: { companyId: string }) {
  if (isSampleCompany(companyId))
    return (
      <RecordView
        name="Kestrel Data"
        approvals={[]}
        activity={[]}
        branches={[]}
        companyPath="/c/kestrel"
        sample
      />
    );
  const id = resolveCompanyId(companyId);
  return id.success && process.env.NEXT_PUBLIC_CONVEX_URL ? (
    <LiveRecord companyId={id.data} />
  ) : (
    <p className="text-sm">
      This company link is not available. Check the link or open the sample company.
    </p>
  );
}
