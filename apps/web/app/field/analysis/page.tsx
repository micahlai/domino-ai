import { FieldTraceView } from "@/components/field/trace/FieldTraceView";
import { Suspense } from "react";

export const metadata = { title: "How we got here" };

export default function Page() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL)
    return <p role="alert">A backend connection is needed to read this saved run.</p>;
  return (
    <Suspense fallback={<p>Reading the saved run...</p>}>
      <FieldTraceView />
    </Suspense>
  );
}
