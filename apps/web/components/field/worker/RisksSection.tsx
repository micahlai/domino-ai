"use client";

import { ArrowUpRight, ShieldAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "../../../lib/utils";
import { Badge } from "../../ui/badge";
import { Skeleton } from "../../ui/skeleton";
import { money } from "./format";
import { EmptyCard, WorkerSection, linkClass } from "./parts";
import { SOURCE_LABEL, type WatchedRisk, riskSentence } from "./risks";

const STATUS_BADGE: Record<
  WatchedRisk["status"],
  { label: string; variant: "destructive" | "success" }
> = {
  below: { label: "Below minimum", variant: "destructive" },
  rule: { label: "Breaks a rule", variant: "destructive" },
  holds: { label: "Holds", variant: "success" },
};

export function RisksSection({
  rows,
  loading,
  action,
}: {
  rows: WatchedRisk[];
  loading: boolean;
  /** "Open in timeline": saves these books as a Timeline forecast and opens it. */
  action?: ReactNode;
}) {
  const failing = rows.filter((r) => r.status !== "holds").length;
  const sample = rows.length > 0 && rows.every((r) => r.source === "sample");
  return (
    <WorkerSection
      id="risks"
      step={2}
      title="Risks we're watching"
      description="What could go wrong in the next 13 weeks, each run through your forecast."
      actions={action}
    >
      {loading ? (
        <div aria-busy="true">
          <p className="sr-only">Loading risk scenarios</p>
          <Skeleton className="h-28 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyCard icon={<ShieldAlert />}>
          <p className="font-medium text-foreground">No risk scenarios yet.</p>
          <p>
            Open these books in Timeline. Its analysis tests what could go wrong, and each scenario
            appears here when the analysis finishes.
          </p>
        </EmptyCard>
      ) : (
        <>
          {sample ? (
            <p className="text-[13px] leading-5 text-muted-foreground">
              Sample events picked by a simple rule until Timeline's analysis runs. Each outcome is
              the real forecast with that change applied.
            </p>
          ) : null}
          <ul
            className="divide-y overflow-hidden rounded-lg border bg-card shadow-xs"
            aria-label={`${rows.length} risk scenarios, ${failing} below the minimum or breaking a rule`}
          >
            {rows.map((r) => (
              <RiskRow key={`${r.source}-${r.id}`} risk={r} />
            ))}
          </ul>
        </>
      )}
    </WorkerSection>
  );
}

function RiskRow({ risk: r }: { risk: WatchedRisk }) {
  const badge = STATUS_BADGE[r.status];
  return (
    <li className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge variant={badge.variant}>{badge.label}</Badge>
          <span className="text-xs text-muted-foreground">{SOURCE_LABEL[r.source]}</span>
        </div>
        <p className="mt-1.5 text-sm font-medium leading-5">{r.title}</p>
        <p
          className={cn(
            "mt-0.5 text-[13px] leading-5",
            r.status === "holds" ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {riskSentence(r)}
        </p>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-5 sm:justify-end">
        {r.low ? (
          <p className="sm:text-right">
            <span className="block text-xs text-muted-foreground">Lowest cash</span>
            <span
              className={cn(
                "block text-[15px] font-semibold tabular-nums",
                r.status === "below" && "text-destructive",
              )}
            >
              {money(r.low.cents)}
            </span>
          </p>
        ) : null}
        {r.href ? (
          <Link href={r.href} className={linkClass}>
            Open in timeline
            <ArrowUpRight aria-hidden="true" className="size-3.5" />
          </Link>
        ) : null}
      </div>
    </li>
  );
}
