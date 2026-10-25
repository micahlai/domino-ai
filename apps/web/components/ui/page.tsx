import type * as React from "react";

import { cn } from "../../lib/utils";

// Shared page scaffolding for the dashboard look. Layout only: no data fetching, no money math.
// Values arrive already formatted (formatCents etc.), so these helpers never guess units.

export interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  title: React.ReactNode;
  /** Small muted line above the title, e.g. a company name or breadcrumb. */
  eyebrow?: React.ReactNode;
  description?: React.ReactNode;
  /** Buttons on the right; they wrap under the title on narrow screens. */
  actions?: React.ReactNode;
}

/** One page title per screen, with an optional eyebrow, description and actions. */
export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  className,
  ...props
}: PageHeaderProps) {
  return (
    <header
      className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-4", className)}
      {...props}
    >
      <div className="min-w-0 max-w-3xl">
        {eyebrow ? <div className="mb-1.5 text-sm text-muted-foreground">{eyebrow}</div> : null}
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-foreground md:text-[28px] md:leading-9">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export interface SectionProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Draw the body inside a bordered card. Default true. */
  card?: boolean;
  /** Remove body padding, for a table or list that runs edge to edge inside the card. */
  flush?: boolean;
}

/** A titled block of a page. The heading sits outside the card, like a ledger section. */
export function Section({
  title,
  description,
  actions,
  card = true,
  flush = false,
  className,
  children,
  ...props
}: SectionProps) {
  return (
    <section className={cn("min-w-0 space-y-3", className)} {...props}>
      {title || actions ? (
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            {title ? (
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="mt-0.5 text-sm leading-5 text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {card ? (
        <div
          className={cn(
            "overflow-hidden rounded-lg border bg-card text-card-foreground shadow-xs",
            !flush && "p-[var(--card-pad)]",
          )}
        >
          {children}
        </div>
      ) : (
        children
      )}
    </section>
  );
}

const toneClass = {
  neutral: "text-muted-foreground",
  positive: "text-safe",
  warning: "text-warning",
  negative: "text-destructive",
} as const;

export interface StatTileProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode;
  /** Pre-formatted value, e.g. "$2.9M". */
  value: React.ReactNode;
  /** Unit or date context shown after the value, e.g. "by Nov 30". */
  unit?: React.ReactNode;
  /** Short change or status line under the value, e.g. "-$240K vs last week". */
  delta?: React.ReactNode;
  /** Colours the delta only. Green for working, amber for watch, red for broken rules. */
  tone?: keyof typeof toneClass;
}

/** One KPI: muted label, strong tabular number, optional delta. Put several in a grid. */
export function StatTile({
  label,
  value,
  unit,
  delta,
  tone = "neutral",
  className,
  ...props
}: StatTileProps) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border bg-card p-4 text-card-foreground shadow-xs",
        className,
      )}
      {...props}
    >
      <div className="truncate text-[13px] text-muted-foreground">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular-nums tracking-[-0.02em]">{value}</span>
        {unit ? <span className="text-sm text-muted-foreground">{unit}</span> : null}
      </div>
      {delta ? (
        <div className={cn("mt-1 text-[13px] tabular-nums", toneClass[tone])}>{delta}</div>
      ) : null}
    </div>
  );
}
