import { InvestigateLive } from "@/components/investigate/live/InvestigateLive";
import { Suspense } from "react";

export const metadata = { title: "Investigate" };

export default function Page() {
  // data-style pins the Original dark tokens whatever style the user picked elsewhere.
  return (
    <div data-style="original" className="h-full bg-background text-foreground">
      <Suspense fallback={null}>
        <InvestigateLive />
      </Suspense>
    </div>
  );
}
