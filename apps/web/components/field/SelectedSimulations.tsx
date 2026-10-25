"use client";

import { WorkspaceLive } from "../timeline/workspace/WorkspaceLive";
import { ReplayGuard } from "./ReplayGuard";
import { TimelineBridge } from "./TimelineBridge";
import { AgentsGate, AgentsIdleCard } from "./agents";
import { operatingWorldId, useOperatingSelection } from "./company";

/** Simulations page: Timeline's saved runs for the company picked in the top bar (TL7). */
export function SelectedSimulations() {
  const companyId = operatingWorldId(useOperatingSelection());
  return (
    <ReplayGuard>
      <AgentsGate
        idle={(state) => (
          <AgentsIdleCard
            state={state}
            detail="Saved forecasts and what-ifs start from the books the agents read. Start the agents on the Brain map; the first forecast appears here once they finish."
          />
        )}
      >
        <div className="space-y-6">
          <TimelineBridge companyId={companyId} />
          <WorkspaceLive key={companyId} companyId={companyId} />
        </div>
      </AgentsGate>
    </ReplayGuard>
  );
}
