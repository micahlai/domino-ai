"use client";

import { motion, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useRef, useSyncExternalStore } from "react";
import { Segmented } from "../../ui/segmented";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../ui/sheet";

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
 * Questions and the what-if chat in one place: pinned to the right of the page at full window
 * height on desktop, a slide-over sheet on phones. Each conversation scrolls on its own with
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
}: {
  tab: AssistantTab;
  onTab: (tab: AssistantTab) => void;
  /** Phones only: whether the sheet is open. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Changes when a page action asks for the input to be focused. */
  focusKey: number;
  ask: ReactNode;
  chat: ReactNode | null;
}) {
  const desktop = useIsDesktop();
  const body = <AssistantBody tab={tab} onTab={onTab} focusKey={focusKey} ask={ask} chat={chat} />;
  if (desktop)
    return (
      <aside
        aria-label="Ask or try a what-if"
        className="hidden min-w-0 lg:sticky lg:top-20 lg:flex lg:h-[calc(100dvh-6rem)] lg:flex-col lg:rounded-lg lg:border lg:bg-card lg:p-4 lg:shadow-xs"
        data-testid="assistant"
      >
        {body}
      </aside>
    );
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex h-full w-full flex-col gap-3 p-4 pt-5 sm:max-w-md"
        data-testid="assistant"
      >
        <SheetHeader>
          <SheetTitle>Ask or try a what-if</SheetTitle>
          <SheetDescription className="sr-only">
            Ask about the saved forecast or describe a what-if. Nothing is calculated until you
            review and save.
          </SheetDescription>
        </SheetHeader>
        {body}
      </SheetContent>
    </Sheet>
  );
}

function AssistantBody({
  tab,
  onTab,
  focusKey,
  ask,
  chat,
}: {
  tab: AssistantTab;
  onTab: (tab: AssistantTab) => void;
  focusKey: number;
  ask: ReactNode;
  chat: ReactNode | null;
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
      {chat ? (
        <Segmented
          label="Assistant mode"
          name="timeline-assistant"
          value={tab}
          onChange={onTab}
          options={[
            { value: "ask", label: "Ask a question" },
            { value: "chat", label: "What-if chat" },
          ]}
          className="w-full shrink-0 [&>label]:flex-1 [&>label>span]:h-9 [&>label>span]:justify-center max-sm:[&>label>span]:h-11"
        />
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
