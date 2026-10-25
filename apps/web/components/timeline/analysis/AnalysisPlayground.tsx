"use client";
import { useState } from "react";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { fixtureScenario } from "../workspace/fixtures";
import { AnalysisView } from "./AnalysisView";
import type { AnalysisReceipt } from "./api";
import { fixtureAnalysisRun, fixtureAttempt } from "./fixtures";
export function AnalysisPlayground() {
  const [status, setStatus] = useState<AnalysisReceipt["status"]>("succeeded");
  const [scenario, setScenario] = useState(false);
  const receipt = fixtureAttempt(status);
  const run = scenario ? fixtureScenario : fixtureAnalysisRun;
  const refuse = async () => ({
    ok: false as const,
    message: "Fixture only: no job started, output generated or data saved.",
  });
  return (
    <section className="min-w-0 space-y-5">
      <Badge variant="outline">Analysis fixtures · no live writes</Badge>
      <div className="flex flex-wrap gap-2">
        {(["queued", "running", "succeeded", "partial", "failed"] as const).map((s) => (
          <Button
            key={s}
            variant={s === status ? "default" : "outline"}
            onClick={() => setStatus(s)}
          >
            {s}
          </Button>
        ))}
        <Button
          variant={scenario ? "default" : "outline"}
          aria-pressed={scenario}
          onClick={() => setScenario(!scenario)}
        >
          Toggle event-run restriction
        </Button>
      </div>
      <AnalysisView
        key={`${status}-${scenario}`}
        run={run}
        selected={scenario ? null : { state: "ready", value: receipt }}
        history={{ state: "ready", value: scenario ? [] : [receipt] }}
        actions={{ start: refuse, retry: refuse, exportOutput: refuse }}
        disabled="Playground fixture: results are sample data; no live analysis can start."
      />
    </section>
  );
}
