import type * as React from "react";
import { cn } from "../../lib/utils";

// A card with its own header bar, for cards that sit inside a page Section (the Section owns the
// h2; panels use h3). Layout only. Body runs edge to edge unless `padded`.

export interface PanelProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Right side of the header: a count, a link or a small button. */
  aside?: React.ReactNode;
  padded?: boolean;
  as?: "section" | "article" | "div";
  /** h3 inside a page Section (default); h2 when the panel is itself a top-level block. */
  level?: "h2" | "h3";
}

export function Panel({
  title,
  description,
  aside,
  padded = false,
  as: Tag = "section",
  level: Heading = "h3",
  className,
  children,
  ...props
}: PanelProps) {
  return (
    <Tag
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card text-card-foreground shadow-xs",
        className,
      )}
      {...props}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-b px-4 py-3">
        <div className="min-w-0">
          <Heading className="text-sm font-semibold tracking-[-0.005em]">{title}</Heading>
          {description ? (
            <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {aside ? <div className="flex shrink-0 items-center gap-2">{aside}</div> : null}
      </header>
      <div className={cn("min-w-0 flex-1", padded && "p-4")}>{children}</div>
    </Tag>
  );
}

/** Quiet empty state for a list or table: one plain sentence, optional icon. */
export function EmptyRow({
  icon,
  children,
}: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-8 text-sm text-muted-foreground">
      {icon ? (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4">
          {icon}
        </span>
      ) : null}
      <p className="leading-5">{children}</p>
    </div>
  );
}
