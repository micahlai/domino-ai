import { WorkspaceLive } from "@/components/timeline/workspace/WorkspaceLive";
import { SyncCompany } from "@/components/timeline/workspace/books";
import { decodeTimelineCompanyId } from "@/lib/timeline-route";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Timeline" };

/**
 * The selected company's timeline. With no address it opens the latest imported books (or
 * explains how to bring them in); ?runId= reopens a saved scenario, ?view=all lists them all,
 * ?baselineRunId= starts from a saved baseline.
 */
export default async function Page({ params }: { params: Promise<{ companyId: string }> }) {
  const companyId = decodeTimelineCompanyId((await params).companyId);
  return (
    <div className="min-w-0">
      <SyncCompany companyId={companyId} />
      <WorkspaceLive key={companyId} companyId={companyId} landing="latest" />
    </div>
  );
}
