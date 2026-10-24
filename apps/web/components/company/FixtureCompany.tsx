"use client";

import { FixCard } from "@/components/FixCard";
import type { Cents } from "@domino/contracts";
import { fixtures } from "@domino/contracts/fixtures";
import { CompanyWorkspace, type WorkspaceData } from "./CompanyWorkspace";
import { UnavailableAction } from "./UnavailableAction";
import { matchingFixBranch } from "./selection";

const data: WorkspaceData = {
  company: { name: "Kestrel Data", today: fixtures.snapshot.asOf },
  history: { weeks: fixtures.history, pastEvents: fixtures.pastEvents },
  report: fixtures.resilience,
  reportWithFixes: fixtures.resilienceWithFixes,
  constraints: fixtures.constraints,
  risks: [...fixtures.risks, ...fixtures.moreRisks],
  branches: fixtures.branches,
};
// Saved fixture scores from the backend seed, not a forecast computed in the UI.
const gains: Record<string, Cents> = { fix_early_pay: 23_500_000, fix_delay_hire: 4_400_000 };

export function FixtureCompany() {
  return (
    <CompanyWorkspace
      data={data}
      sample
      actions={
        <div className="flex flex-wrap gap-2">
          <UnavailableAction
            label="Add event"
            reason="Sample data only. New events will be available when live forecasting is ready."
          />
          <UnavailableAction
            label="Next week"
            reason="Sample data only. Advancing weeks will be available when live forecasting is ready."
          />
        </div>
      }
      renderFixes={(branch) => {
        const candidates = fixtures.fixes.filter((fix) =>
          matchingFixBranch(branch, fix, fixtures.branches),
        );
        return candidates.length ? (
          <div className="space-y-4">
            {candidates.map((fix) => (
              <FixCard
                key={fix.id}
                fix={fix}
                gain={gains[fix.id]}
                simulatedBranch={matchingFixBranch(branch, fix, fixtures.branches)}
                sample
                onApprove={async () => undefined}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No fixes have been saved for this scenario.
          </p>
        );
      }}
    />
  );
}
