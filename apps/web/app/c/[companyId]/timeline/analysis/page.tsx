import { TimelineBridge } from "@/components/field/TimelineBridge";
import { AnalysisLive } from "@/components/timeline/analysis/AnalysisLive";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "Timeline risk analysis" };
export default async function Page({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  return (
    <div className="min-w-0 space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-medium">Timeline risk analysis</h1>
        <p className="text-sm text-muted-foreground">
          Review possible cash risks, response costs and saved evidence.
        </p>
      </div>
      <TimelineBridge companyId={companyId} />
      <AnalysisLive key={companyId} companyId={companyId} />
    </div>
  );
}
