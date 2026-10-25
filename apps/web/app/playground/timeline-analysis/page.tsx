import { AnalysisPlayground } from "@/components/timeline/analysis/AnalysisPlayground";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "Timeline analysis playground" };
export default function Page() {
  return (
    <div className="min-w-0 space-y-6">
      <h1 className="text-3xl font-medium">Timeline analysis preview</h1>
      <AnalysisPlayground />
    </div>
  );
}
