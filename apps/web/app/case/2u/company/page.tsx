import { CompanyView } from "@/components/case-workspace/CompanyView";
import { Suspense } from "react";

export const metadata = { title: "Company · 2U" };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <CompanyView />
    </Suspense>
  );
}
