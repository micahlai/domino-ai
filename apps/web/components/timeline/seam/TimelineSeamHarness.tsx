"use client";

import type { TimelineSeedV1 } from "@domino/contracts";
import { useEffect, useState } from "react";
import {
  type FixtureName,
  type Verified,
  fixtureText,
  verifySeedText,
} from "../../../lib/feature-boundary/verify";
import { HistoricalReplay } from "../../historical/HistoricalReplay";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { seedView } from "./seedView";

const SEEDS: { name: FixtureName; label: string }[] = [
  { name: "validTwoUSeed", label: "Valid 2U seed" },
  { name: "blockedSeed", label: "Blocked seed (synthetic)" },
  { name: "mismatchedSeed", label: "Mismatched seed (synthetic)" },
];

/** Timeline seam smoke test: import seed JSON text, verify it in the browser, then render it. */
export function TimelineSeamHarness() {
  const [text, setText] = useState(() => fixtureText("validTwoUSeed"));
  const [result, setResult] = useState<Verified<TimelineSeedV1> | "checking">("checking");

  useEffect(() => {
    let live = true;
    setResult("checking");
    verifySeedText(text, { forecastReady: true }).then(
      (r) => live && setResult(r),
      () => live && setResult({ ok: false, reason: "verification could not run" }),
    );
    return () => {
      live = false;
    };
  }, [text]);

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-dashed text-clay">
            Peer fixture
          </Badge>
          {SEEDS.map((s) => (
            <Button
              key={s.name}
              size="sm"
              variant="secondary"
              onClick={() => setText(fixtureText(s.name))}
            >
              Load {s.label}
            </Button>
          ))}
        </div>
        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">
            TimelineSeedV1 JSON text (paste a Field export here; edits are re-verified)
          </span>
          <textarea
            aria-label="Seed JSON text"
            className="h-40 w-full rounded-md border bg-background p-2 font-mono text-xs"
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <output data-testid="seed-verification" className="block text-sm">
          {result === "checking"
            ? "Verifying..."
            : result.ok
              ? `Verified: seed ${result.contentHash}, snapshot ${result.snapshotContentHash}`
              : `Rejected: ${result.reason}`}
        </output>
      </section>
      {result !== "checking" && result.ok ? (
        <HistoricalReplay view={seedView(result.value)} />
      ) : (
        <HistoricalReplay
          status="unavailable"
          statusMessage="Only a verified, forecast-ready seed is rendered."
        />
      )}
    </div>
  );
}
