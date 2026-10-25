import { AnalysisLive } from "@/components/timeline/analysis/AnalysisLive";
import { SyncCompany } from "@/components/timeline/workspace/books";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "Saved risks" };
export default async function Page({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  return (
    <div className="min-w-0">
      <SyncCompany companyId={companyId} />
      <AnalysisLive key={companyId} companyId={companyId} />
    </div>
  );
}
