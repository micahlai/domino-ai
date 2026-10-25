"use client";

import { motion, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useRef, useSyncExternalStore } from "react";

export type AssistantTab = "ask" | "chat";

/** Smooth scrolling only when the person has not asked for reduced motion. */
export const smoothScroll = (): ScrollBehavior =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

const DESKTOP = "(min-width: 1024px)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(DESKTOP);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** Desktop on the server and before hydration; CSS keeps the sidebar hidden on phones meanwhile. */
export const useIsDesktop = () =>
  useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DESKTOP).matches,
    () => true,
  );

/**
 * One chat for questions and what-ifs, pinned to the right of the page at full window
 * height on desktop, an overlay sidebar on phones. Each conversation scrolls on its own with
 * its composer pinned at the bottom. Both tabs stay mounted so a typed draft survives switching.
 */
export function Assistant({
  tab,
  onTab,
  open,
  onOpenChange,
  focusKey,
  ask,
  chat,
  askCount = 0,
}: {
  tab: AssistantTab;
  onTab: (tab: AssistantTab) => void;
  /** Saved one-off questions, reachable from the chat as "Earlier questions". */
  askCount?: number;
  /** Whether the sidebar is expanded at any viewport size. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Changes when a page action asks for the input to be focused. */
  focusKey: number;
  ask: ReactNode;
  chat: ReactNode | null;
}) {
  const body = (
    <AssistantBody
      tab={tab}
      onTab={onTab}
      focusKey={focusKey}
      ask={ask}
      chat={chat}
      askCount={askCount}
    />
  );
  return (
    <aside
      id="workspace-assistant"
      aria-label="Ask Domino"
      hidden={!open}
      className={`${open ? "flex" : "hidden"} absolute inset-y-0 right-0 z-40 min-h-0 w-[min(100%,23rem)] shrink-0 flex-col gap-3 border-l bg-card p-3 lg:relative lg:inset-auto lg:z-auto lg:w-80 xl:w-[22rem]`}
      data-testid="assistant"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onOpenChange(false);
          document.querySelector<HTMLButtonElement>('[data-testid="action-ask"]')?.focus();
        }
      }}
    >
      <div className="flex shrink-0 items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Ask Domino</h2>
      </div>
      {body}
    </aside>
  );
}

function AssistantBody({
  tab,
  onTab,
  focusKey,
  ask,
  chat,
  askCount,
}: {
  tab: AssistantTab;
  onTab: (tab: AssistantTab) => void;
  focusKey: number;
  ask: ReactNode;
  chat: ReactNode | null;
  askCount: number;
}) {
  const root = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus only when an action asks
  useEffect(() => {
    if (!focusKey) return;
    const frame = requestAnimationFrame(() => {
      const panel = root.current?.querySelector<HTMLElement>(`[data-assistant-tab="${tab}"]`);
      const target =
        panel?.querySelector<HTMLElement>("textarea:not(:disabled), input:not(:disabled)") ??
        panel?.querySelector<HTMLElement>("button:not(:disabled)");
      target?.focus();
      if (window.matchMedia(DESKTOP).matches)
        panel?.scrollIntoView({ block: "nearest", behavior: smoothScroll() });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusKey]);
  const reduced = useReducedMotion();
  const show = (visible: boolean) =>
    reduced
      ? {}
      : {
          initial: false as const,
          animate: visible ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 },
          transition: { duration: 0.18, ease: "easeOut" as const },
        };
  return (
    <div ref={root} className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      {chat && (askCount > 0 || tab === "ask") ? (
        <div className="flex shrink-0 justify-end">
          <button
            type="button"
            onClick={() => onTab(tab === "ask" ? "chat" : "ask")}
            className="text-xs text-primary underline-offset-4 hover:underline"
            data-testid="assistant-history-toggle"
          >
            {tab === "ask" ? "Back to the chat" : `Earlier questions (${askCount})`}
          </button>
        </div>
      ) : null}
      <motion.div
        className="min-h-0 flex-1"
        data-assistant-tab="ask"
        hidden={tab !== "ask"}
        {...show(tab === "ask")}
      >
        {ask}
      </motion.div>
      {chat ? (
        <motion.section
          aria-label="Timeline chat"
          id="timeline-chat"
          className="min-h-0 min-w-0 flex-1 scroll-mt-24"
          data-testid="timeline-chat-sidebar"
          data-assistant-tab="chat"
          hidden={tab !== "chat"}
          {...show(tab === "chat")}
        >
          {chat}
        </motion.section>
      ) : null}
    </div>
  );
}
