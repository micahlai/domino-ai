import { CASE_BASE, caseHref } from "@/components/case-workspace/links";
import { InvestigateLive } from "@/components/investigate/live/InvestigateLive";
import { Suspense } from "react";

export const metadata = { title: "Workspace · 2U" };

export default function Page() {
  return (
    <div className="h-full">
      <Suspense fallback={null}>
        <InvestigateLive place={{ path: CASE_BASE, newHref: caseHref.workspace() }} />
      </Suspense>
    </div>
  );
}
