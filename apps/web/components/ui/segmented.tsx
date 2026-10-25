"use client";

import { cn } from "../../lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  /** Accessible name for the group, e.g. "Range". */
  label: string;
  /** Unique per page: it groups the native radios. */
  name: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/** Tab-like switch between views or filters. Native radios give arrow keys, one tab stop and
 * screen-reader grouping without a new dependency. For page-level tabs, use links instead. */
export function Segmented<T extends string>({
  label,
  name,
  options,
  value,
  onChange,
  className,
}: SegmentedProps<T>) {
  return (
    <fieldset
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-0.5 overflow-x-auto rounded-md bg-secondary p-0.5",
        className,
      )}
    >
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <label key={option.value} className="relative shrink-0">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="peer sr-only"
          />
          <span className="flex h-7 cursor-pointer items-center rounded-[5px] px-2.5 text-[13px] font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground peer-checked:bg-card peer-checked:text-foreground peer-checked:shadow-sm peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-ring">
            {option.label}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
