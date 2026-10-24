"use client";

import { Switch } from "@/components/ui/switch";
import type { ResilienceReport } from "@domino/contracts";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useId, useRef } from "react";

export function ResilienceBar({
  report,
  reportWithFixes,
  showFixes,
  onToggle,
}: {
  report: ResilienceReport;
  reportWithFixes: ResilienceReport;
  showFixes: boolean;
  onToggle: (value: boolean) => void;
}) {
  const current = showFixes ? reportWithFixes : report;
  const reduced = useReducedMotion();
  const mounted = useRef(false);
  const score = useMotionValue(0);
  const rounded = useTransform(score, Math.round);
  const id = useId();
  const percent = Math.round(current.survivalRate * 100);
  useEffect(() => {
    const controls = animate(score, percent, {
      duration: reduced ? 0 : mounted.current ? 0.6 : 1.1,
      delay: reduced || mounted.current ? 0 : 0.8,
    });
    mounted.current = true;
    return () => controls.stop();
  }, [score, percent, reduced]);
  return (
    <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
      <div className="flex items-center gap-6">
        <p
          aria-hidden="true"
          className="w-28 shrink-0 text-5xl font-medium tabular-nums tracking-tight text-primary"
        >
          <motion.span>{rounded}</motion.span>
          <span className="text-3xl">%</span>
        </p>
        <div>
          <p className="text-base font-medium">
            Survives {current.survivedCount} of {current.universes.length} futures
            <span className="sr-only"> · {percent}% weighted survival</span>
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {current.breakingPoints[0]
              ? `Breaks with ${current.breakingPoints[0].label}.`
              : "No breaking point found in these futures."}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Chance weighted by each possible future.
          </p>
        </div>
      </div>
      <div className="shrink-0">
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm" htmlFor={id}>
          <Switch id={id} checked={showFixes} onCheckedChange={onToggle} />
          Apply fixes
        </label>
        <p className="text-xs text-muted-foreground">Preview only. You decide.</p>
      </div>
    </div>
  );
}
