import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "../../ui/badge";

// Layout pieces shared by the three worker sections.

/** A numbered section of the worker page: the heading sits above its card, as on the dashboard. */
export function WorkerSection({
  id,
  step,
  title,
  count,
  description,
  actions,
  children,
}: {
  id: string;
  step: number;
  title: string;
  /** Open items; hidden while loading and when there are none (the empty state says so). */
  count?: number | null;
  description: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-title`} data-section={id} className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2
            id={`${id}-title`}
            className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em]"
          >
            <span
              aria-hidden="true"
              className="flex size-5 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums text-muted-foreground"
            >
              {step}
            </span>
            {title}
            {count ? (
              <Badge variant="warning" className="tabular-nums">
                {count} open
              </Badge>
            ) : null}
          </h2>
          <p className="mt-0.5 text-sm leading-5 text-muted-foreground">{description}</p>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Quiet empty state: what will appear here, and when. */
export function EmptyCard({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-dashed bg-card px-4 py-5 text-sm text-muted-foreground">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted [&_svg]:size-4">
        {icon}
      </span>
      <div className="min-w-0 space-y-1 leading-5">{children}</div>
    </div>
  );
}

/** A collapsed "Decided" list under a section. */
export function DecidedDetails({
  count,
  noun,
  children,
}: { count: number; noun: [string, string]; children: ReactNode }) {
  return (
    <details className="group overflow-hidden rounded-lg border bg-card text-sm shadow-xs">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 font-medium hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <span>
          Decided
          <span className="ml-2 font-normal text-muted-foreground">
            {count} {count === 1 ? noun[0] : noun[1]}
          </span>
        </span>
        <ChevronRight
          aria-hidden="true"
          className="size-4 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none"
        />
      </summary>
      <ul className="divide-y border-t">{children}</ul>
    </details>
  );
}

export const linkClass =
  "inline-flex min-h-11 items-center gap-1 rounded text-[13px] font-medium text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring sm:min-h-0";
