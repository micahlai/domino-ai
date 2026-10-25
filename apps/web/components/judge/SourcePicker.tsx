"use client";

import { Check, Lock } from "lucide-react";
import { cn } from "../../lib/utils";
import { ToolLogo } from "../icons/ToolLogo";

// Data source tiles with on/off toggles. Used by the judge sandbox (step 2) and by the guided
// start panel on idle operating companies (components/field/agents.tsx).

export type SourceTile = { vendor: string; name: string; gives: string };

/** Flip one tool. The required tool never turns off; turning a tool off also drops its dependents. */
export function toggleSource<T extends string>(
  current: ReadonlySet<T>,
  tool: T,
  required: T,
  needs: Partial<Record<T, { needs: T }>>,
): ReadonlySet<T> {
  if (tool === required) return current;
  const next = new Set(current);
  if (!next.delete(tool)) next.add(tool);
  for (const [t, rule] of Object.entries(needs) as [T, { needs: T } | undefined][])
    if (rule && !next.has(rule.needs)) next.delete(t);
  return next;
}

export function SourcePicker<T extends string>({
  tools,
  tiles,
  on,
  required,
  needs,
  onToggle,
  disabled = false,
  className,
}: {
  tools: readonly T[];
  tiles: Record<T, SourceTile>;
  on: ReadonlySet<T>;
  required: T | null;
  needs: Partial<Record<T, { needs: T }>>;
  onToggle: (tool: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <fieldset disabled={disabled}>
      <legend className="sr-only">Data sources</legend>
      <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3", className)}>
        {tools.map((t) => {
          const tile = tiles[t];
          const checked = on.has(t);
          const isRequired = t === required;
          const rule = needs[t];
          const blocked = rule !== undefined && !on.has(rule.needs);
          return (
            <label
              key={t}
              className={cn(
                "flex items-center gap-3 rounded-lg border bg-card p-4 shadow-xs transition-colors",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2",
                checked ? "border-foreground/60" : "opacity-60 hover:opacity-100",
                isRequired || blocked ? "cursor-default" : "cursor-pointer",
              )}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                disabled={isRequired || blocked}
                onChange={() => onToggle(t)}
                aria-describedby={`src-${t}`}
              />
              <ToolLogo vendor={tile.vendor} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{tile.name}</span>
                <span id={`src-${t}`} className="block text-[13px] text-muted-foreground">
                  {isRequired
                    ? "Required"
                    : blocked && rule
                      ? `Needs ${tiles[rule.needs].name}`
                      : tile.gives}
                </span>
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded border",
                  checked ? "border-foreground bg-foreground text-background" : "border-input",
                )}
              >
                {isRequired ? (
                  <Lock className="size-3" />
                ) : checked ? (
                  <Check className="size-3.5" strokeWidth={3} />
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
