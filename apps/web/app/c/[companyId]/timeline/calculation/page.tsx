import { CalculationView } from "@/components/timeline/calculation/CalculationView";
import { decodeTimelineCompanyId } from "@/lib/timeline-route";
import { Suspense } from "react";

export const metadata = { title: "How we got here" };

export default async function Page({ params }: { params: Promise<{ companyId: string }> }) {
  const companyId = decodeTimelineCompanyId((await params).companyId);
  if (!process.env.NEXT_PUBLIC_CONVEX_URL)
    return <p role="alert">A backend connection is needed to read this saved calculation.</p>;
  return (
    <Suspense fallback={<p>Reading saved calculation...</p>}>
      <CalculationView companyId={companyId} />
    </Suspense>
  );
}
