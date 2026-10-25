"use client";

import { WorkspaceLive } from "../timeline/workspace/WorkspaceLive";
import { ReplayGuard } from "./ReplayGuard";
import { TimelineBridge } from "./TimelineBridge";
import { operatingWorldId, useOperatingSelection } from "./company";

/** Simulations page: Timeline's saved runs for the company picked in the top bar (TL7). */
export function SelectedSimulations() {
  const companyId = operatingWorldId(useOperatingSelection());
  return (
    <ReplayGuard>
      <div className="space-y-6">
        <TimelineBridge companyId={companyId} />
        <WorkspaceLive key={companyId} companyId={companyId} />
      </div>
    </ReplayGuard>
  );
}
