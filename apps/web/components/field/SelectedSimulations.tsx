"use client";

import Link from "next/link";
import { WorkspaceLive } from "../timeline/workspace/WorkspaceLive";
import { TimelineBridge } from "./TimelineBridge";
import { useIsReplayCompany, useSelectedProfile } from "./company";

/** Simulations page: Timeline's saved runs for the company picked in the top bar (TL7). */
export function SelectedSimulations() {
  const profile = useSelectedProfile();
  if (useIsReplayCompany())
    return (
      <p className="rounded-lg border p-5 text-sm text-muted-foreground">
        2U is replayed from public filings and has no weekly timeline. Its saved investigations are
        in the{" "}
        <Link href="/case/2u/simulations" className="text-primary hover:underline">
          2U case simulations
        </Link>
        .
      </p>
    );
  return (
    <div className="space-y-6">
      <TimelineBridge companyId={profile} />
      <WorkspaceLive key={profile} companyId={profile} />
    </div>
  );
}
