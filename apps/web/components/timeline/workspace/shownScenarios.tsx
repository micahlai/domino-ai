"use client";

import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from "react";
import { assignColors } from "./scenarioComparisons";

/**
 * Which saved scenarios are drawn on the chart, and in which color. Held above the open run
 * so checking boxes, or switching the scenario new what-ifs build on, never resets it.
 */
type Shown = {
  /** Shown run ids in color-slot order. */
  ids: string[];
  colors: Record<string, number>;
  set: (ids: string[]) => void;
};

const ShownContext = createContext<Shown | null>(null);

export function ShownScenariosProvider({ children }: { children: ReactNode }) {
  const [colors, setColors] = useState<Record<string, number>>({});
  const set = useCallback((ids: string[]) => setColors((prev) => assignColors(prev, ids)), []);
  const value = useMemo(
    () => ({
      ids: Object.keys(colors).sort((a, b) => (colors[a] ?? 0) - (colors[b] ?? 0)),
      colors,
      set,
    }),
    [colors, set],
  );
  return <ShownContext.Provider value={value}>{children}</ShownContext.Provider>;
}

/** Shared selection when a provider is mounted; a local one otherwise (playground, tests). */
export function useShownScenarios(): Shown {
  const shared = useContext(ShownContext);
  const [colors, setColors] = useState<Record<string, number>>({});
  const set = useCallback((ids: string[]) => setColors((prev) => assignColors(prev, ids)), []);
  const local = useMemo(
    () => ({
      ids: Object.keys(colors).sort((a, b) => (colors[a] ?? 0) - (colors[b] ?? 0)),
      colors,
      set,
    }),
    [colors, set],
  );
  return shared ?? local;
}
