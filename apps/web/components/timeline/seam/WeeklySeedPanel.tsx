"use client";

import type { WeeklySeedV1 } from "@domino/contracts";
import { useEffect, useState } from "react";
import {
  type Verified,
  type WeeklyFixtureName,
  verifyWeeklySeedText,
  weeklyFixtureText,
} from "../../../lib/feature-boundary/verify";
import { formatCents, formatDate } from "../../../lib/format";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";

const SEEDS: { name: WeeklyFixtureName; label: string }[] = [
  { name: "validKestrelWeeklySeed", label: "Valid Kestrel weekly seed" },
  { name: "tamperedKestrelWeeklySeed", label: "Tampered weekly seed" },
];

/** What Timeline reads from a verified weekly seed: company, week 0, scheduled items, findings. */
export function WeeklySeedSummary({ seed }: { seed: WeeklySeedV1 }) {
  return (
    <div className="space-y-3 text-sm">
      <p>
        <span className="font-medium">{seed.company.name}</span> ({seed.company.id}), weeks from{" "}
        {formatDate(seed.asOf)}. Cash on hand {formatCents(seed.snapshot.cashOnHand)}.
      </p>
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="text-muted-foreground">
            <th className="py-1 pr-4 font-normal">Week</th>
            <th className="py-1 pr-4 font-normal">Item</th>
            <th className="py-1 pr-4 font-normal">Counterparty</th>
            <th className="py-1 pr-4 text-right font-normal">Amount</th>
            <th className="py-1 font-normal">Status</th>
          </tr>
        </thead>
        <tbody>
          {seed.scheduledItems.map((item) => (
            <tr key={item.id} data-testid={`scheduled-${item.id}`}>
              <td className="py-1 pr-4">{formatDate(item.dueWeek)}</td>
              <td className="py-1 pr-4">{item.kind}</td>
              <td className="py-1 pr-4">{item.counterparty}</td>
              <td className="py-1 pr-4 text-right font-mono">{formatCents(item.cents)}</td>
              <td className="py-1">{item.status.replace("_", " ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="space-y-1">
        {seed.findings.map((f) => (
          <li key={f.id} data-testid={`finding-${f.id}`}>
            <Badge variant="outline">{f.severity}</Badge> {f.summary}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Imports WeeklySeedV1 JSON text, recomputes its hash in the browser, then summarizes it. */
export function WeeklySeedPanel() {
  const [text, setText] = useState(() => weeklyFixtureText("validKestrelWeeklySeed"));
  const [result, setResult] = useState<Verified<WeeklySeedV1> | "checking">("checking");

  useEffect(() => {
    let live = true;
    setResult("checking");
    verifyWeeklySeedText(text).then(
      (r) => live && setResult(r),
      () => live && setResult({ ok: false, reason: "verification could not run" }),
    );
    return () => {
      live = false;
    };
  }, [text]);

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">Weekly seed (WeeklySeedV1, seam v2)</h2>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="border-dashed text-clay">
          Peer fixture
        </Badge>
        {SEEDS.map((s) => (
          <Button
            key={s.name}
            size="sm"
            variant="secondary"
            onClick={() => setText(weeklyFixtureText(s.name))}
          >
            Load {s.label}
          </Button>
        ))}
      </div>
      <textarea
        aria-label="Weekly seed JSON text"
        className="h-32 w-full rounded-md border bg-background p-2 font-mono text-xs"
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <output data-testid="weekly-seed-verification" className="block text-sm">
        {result === "checking"
          ? "Verifying..."
          : result.ok
            ? `Verified: weekly seed ${result.contentHash}`
            : `Rejected: ${result.reason}`}
      </output>
      {result !== "checking" && result.ok ? <WeeklySeedSummary seed={result.value} /> : null}
    </section>
  );
}
