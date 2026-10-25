"use client";

import { ArrowRight, Landmark } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "../ui/button";
import { useIsReplayCompany } from "./company";

/**
 * The worker, brain map and connect pages run on a live company feed. 2U is replayed from its
 * public filings and has none, so with 2U selected these pages say so instead of showing
 * another company's data.
 */
export function ReplayGuard({ children }: { children: ReactNode }) {
  if (!useIsReplayCompany()) return children;
  return (
    <div className="mx-auto max-w-[1200px]">
      <div className="rounded-lg border bg-card p-[var(--card-pad)] shadow-xs">
        <div className="flex items-start gap-3">
          <Landmark className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[15px] font-semibold">
              Not connected: 2U is replayed from public filings
            </p>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              2U, Inc. is a real company. Domino reads its quarterly reports, not a live feed of its
              books, so there is no agent, brain map or connected tool to show. Pick a simulated
              company in the top bar to see these pages.
            </p>
            <Button asChild className="mt-4 h-11 sm:h-[var(--control-h)]">
              <Link href="/">
                Open the 2U dashboard
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
