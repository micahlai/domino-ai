"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY } from "../lib/theme-script";
import { cn } from "../lib/utils";

// <html class="dark"> is the single source of truth, so every reader agrees without lifted state.
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const isDark = () => document.documentElement.classList.contains("dark");

function setDark(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
  for (const listener of listeners) listener();
  try {
    localStorage.setItem(THEME_STORAGE_KEY, dark ? "dark" : "light");
  } catch {
    // Storage can be blocked; the choice still applies for this page.
  }
}

export function ThemeToggle({ className }: { className?: string }) {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);
  const Icon = dark ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={() => setDark(!dark)}
      aria-label={dark ? "Use light mode" : "Use dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      className={cn(
        "inline-grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-4" />
    </button>
  );
}
