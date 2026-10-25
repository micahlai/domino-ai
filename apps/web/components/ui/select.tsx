import { ChevronDown } from "lucide-react";
import * as React from "react";

import { cn } from "../../lib/utils";

/** Native select styled like Input. Native keeps keyboard, mobile pickers and form posts for free;
 * className and every select prop go to the <select> itself. */
const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <span className="relative inline-flex w-full min-w-0">
      <select
        ref={ref}
        className={cn(
          "h-[var(--control-h)] w-full min-w-0 cursor-pointer appearance-none rounded-md border border-input bg-card pl-3 pr-8 text-sm text-foreground shadow-xs transition-colors duration-150 hover:border-foreground/25 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </span>
  ),
);
Select.displayName = "Select";

export { Select };
