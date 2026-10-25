import { TimelineSeamHarness } from "@/components/timeline/seam/TimelineSeamHarness";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Timeline seam harness" };

/** Timeline-owned P0-H harness. Not the Timeline feature; a boundary smoke test only. */
export default function Page() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-medium">Timeline seam harness</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          Imports a TimelineSeedV1 as JSON text, recomputes its SHA-256 content hashes and renders
          it through the existing historical replay. The seed below is a labelled P0-C peer fixture,
          not a Field export.
        </p>
      </div>
      <TimelineSeamHarness />
    </div>
  );
}
