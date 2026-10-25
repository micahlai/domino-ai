import { HistoricalLive } from "@/components/historical/HistoricalLive";
import { Suspense } from "react";

export const metadata = { title: "Historical case" };

export default function Page() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-medium">2U cash, late 2023: a look back</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          Save one forecast from what was public at a cutoff date, then reveal what 2U reported
          next. This is a retrospective exercise, not a prediction made at the time.
        </p>
      </div>
      <Suspense fallback={null}>
        <HistoricalLive />
      </Suspense>
    </div>
  );
}
