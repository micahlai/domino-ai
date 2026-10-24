"use client";

import { setStyle, useStyle } from "../lib/style";
import { STYLES } from "../lib/style-registry";

/** Native radios give arrow-key movement, one tab stop and screen-reader grouping for free. */
export function StyleSelector() {
  const current = useStyle();
  return (
    <fieldset className="flex min-w-0 max-w-full flex-wrap items-center gap-1 rounded-lg border bg-card p-0.5">
      <legend className="sr-only">Style</legend>
      {STYLES.map(({ id, label }) => (
        <label key={id} className="relative min-w-0">
          <input
            type="radio"
            name="domino-style"
            value={id}
            checked={current === id}
            onChange={() => setStyle(id)}
            className="peer sr-only"
          />
          <span className="flex min-h-9 cursor-pointer items-center rounded-md px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground peer-checked:bg-primary peer-checked:font-medium peer-checked:text-primary-foreground peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-ring">
            {label}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
