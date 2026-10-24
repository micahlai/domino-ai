"use client";

import type { ResilienceReport } from "@domino/contracts";
import { fixtures } from "@domino/contracts/fixtures";
import { useId, useState } from "react";
import { Switch } from "../ui/switch";
import { MultiverseTimeline } from "./MultiverseTimeline";
import { futureKey } from "./geometry";

function repeatPaths(report: ResilienceReport): ResilienceReport {
  const universes = Array.from({ length: 30 }, (_, index) => {
    const source = report.universes[index % report.universes.length];
    if (!source) throw new Error("Missing particle preview fixture");
    return {
      ...source,
      id: `particle-${index}-${source.id}`,
      riskIds: [...source.riskIds, `preview-${index}`],
      label: `${source.label} (sample ${index + 1})`,
    };
  });
  return {
    ...report,
    universes,
    survivedCount: universes.filter((future) => future.survives).length,
  };
}
const before = repeatPaths(fixtures.resilience);
const after = repeatPaths(fixtures.resilienceWithFixes);

export function ParticleMotionPreview() {
  const [fixes, setFixes] = useState(false);
  const [selected, setSelected] = useState<string>();
  const report = fixes ? after : before;
  const id = useId();
  return (
    <div className="space-y-5">
      <label htmlFor={id} className="flex items-center gap-3 text-sm">
        <Switch id={id} checked={fixes} onCheckedChange={setFixes} />
        Preview fixes across sample paths
      </label>
      <MultiverseTimeline
        history={fixtures.history}
        pastEvents={fixtures.pastEvents}
        today={fixtures.snapshot.asOf}
        report={report}
        comparisonReport={fixes ? before : after}
        limit={300_000_000}
        showFixes={fixes}
        selectedUniverseId={report.universes.find((future) => futureKey(future) === selected)?.id}
        onSelectUniverse={(id) => {
          const future = report.universes.find((item) => item.id === id);
          setSelected(future ? futureKey(future) : undefined);
        }}
      />
    </div>
  );
}
