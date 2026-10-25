import { FieldSeamHarness } from "@/components/field/seam/FieldSeamHarness";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Field seam harness" };

/** Field-owned P0-H harness. Not the Field feature; a boundary smoke test only. */
export default function Page() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-medium">Field seam harness</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          Exports a TimelineSeedV1 as JSON text and shows its verification. The seed is a labelled
          P0-C peer fixture assembled from the public 2U case, not output of the Field backend.
        </p>
      </div>
      <FieldSeamHarness />
    </div>
  );
}
