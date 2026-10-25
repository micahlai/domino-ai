import { TimelineBridge } from "@/components/field/TimelineBridge";
import { WorkspaceLive } from "@/components/timeline/workspace/WorkspaceLive";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Timeline workspace" };

/** Saved Timeline scenarios: ?runId= reopens one, ?baselineRunId= starts from a saved baseline. */
export default async function Page({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-medium">Timeline workspace</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Reopen a saved forecast, check it against cash rules, and try events as new saved
          scenarios. Saved scenarios never change.
        </p>
      </div>
      <TimelineBridge companyId={companyId} />
      <WorkspaceLive key={companyId} companyId={companyId} />
    </div>
  );
}
