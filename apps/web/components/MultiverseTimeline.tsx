import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCents, formatDate } from "@/lib/format";
import type { Cents, HistoryWeek, ISODate, PastEvent, ResilienceReport } from "@domino/contracts";

/** P1 layout stub. P3 replaces the placeholder with the interactive SVG timeline. */
export function MultiverseTimeline({
  history,
  pastEvents,
  today,
  report,
  limit,
}: {
  history: HistoryWeek[];
  pastEvents: PastEvent[];
  today: ISODate;
  report: ResilienceReport;
  limit: Cents;
}) {
  const first = history[0];
  const last = report.universes[0]?.forecast.weeks.at(-1);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span>Cash you can use</span>
        <Badge variant="outline">Timeline layout preview</Badge>
      </div>
      <div className="grid min-h-64 grid-cols-[1fr_auto_1fr] gap-4 rounded-lg bg-muted/70 p-6 md:gap-8">
        <div className="flex flex-col justify-between gap-6">
          <p className="text-sm text-muted-foreground">{history.length} weeks of history</p>
          <div className="space-y-3" aria-hidden="true">
            <Skeleton className="h-2 w-4/5 animate-none" />
            <Skeleton className="h-2 w-3/5 animate-none" />
            <Skeleton className="h-2 w-full animate-none" />
          </div>
          <p className="text-sm text-muted-foreground">
            {first ? formatDate(first.weekStart) : "Past"}
          </p>
        </div>
        <div className="flex flex-col items-center gap-4 text-sm">
          <span>Today</span>
          <div className="flex-1 border-l border-dashed border-muted-foreground/40" />
          <span>{formatDate(today)}</span>
        </div>
        <div className="flex flex-col justify-between gap-6">
          <p className="text-sm text-muted-foreground">
            {report.universes.length} possible futures · 13 weeks
          </p>
          <div className="space-y-3" aria-hidden="true">
            <Skeleton className="h-2 w-full animate-none" />
            <Skeleton className="h-2 w-4/5 animate-none" />
            <Skeleton className="h-2 w-3/5 animate-none" />
          </div>
          <p className="text-right text-sm text-muted-foreground">
            {last ? formatDate(last.weekStart) : "Future"}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap justify-between gap-3 text-sm text-muted-foreground">
        <span>{pastEvents.length} past events ready to explore</span>
        <span>Lender’s limit: {formatCents(limit)}</span>
      </div>
      <p className="text-sm text-muted-foreground">
        The interactive timeline comes next. This preview uses the shared Kestrel fixtures.
      </p>
    </div>
  );
}
