"use client";

import { motion, useReducedMotion } from "motion/react";
import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useRef } from "react";

/** Enter sends, Shift+Enter keeps a new line. IME composition never sends early. */
export function submitOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}

/** Keep a scroll area pinned to its newest message whenever `key` changes. */
export function useFollowScroll(ref: RefObject<HTMLElement | null>, key: unknown) {
  const reduced = useReducedMotion();
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow only when the content key moves
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const frame = requestAnimationFrame(() =>
      el.scrollTo({ top: el.scrollHeight, behavior: reduced ? "auto" : "smooth" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [key]);
}

/**
 * A chat column that fills its parent: the conversation scrolls on its own and the composer
 * stays pinned at the bottom.
 */
export function ChatScrollFrame({
  children,
  composer,
  followKey,
  label,
}: {
  children: ReactNode;
  composer?: ReactNode;
  followKey: unknown;
  label: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useFollowScroll(scroller, followKey);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scroller}
        aria-label={label}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pr-1"
        data-testid="chat-scroll"
      >
        {children}
      </div>
      {composer ? <div className="shrink-0 border-t pt-3">{composer}</div> : null}
    </div>
  );
}

/** Entrance for a new message or card. Reduced motion shows it at once. */
export function useEnter() {
  const reduced = useReducedMotion();
  return reduced
    ? {}
    : {
        initial: { opacity: 0, y: 10, scale: 0.98 },
        animate: { opacity: 1, y: 0, scale: 1 },
        transition: { type: "spring" as const, stiffness: 420, damping: 32, mass: 0.7 },
      };
}

/** Three pulsing dots while Domino is writing. */
export function TypingDots({ label = "Thinking…" }: { label?: string }) {
  const reduced = useReducedMotion();
  return (
    <output
      aria-live="polite"
      className="mr-auto flex w-fit items-center gap-2 rounded-lg border px-4 py-3 text-sm text-muted-foreground"
      data-testid="chat-typing"
    >
      <span className="sr-only">{label}</span>
      <span aria-hidden="true" className="flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="size-1.5 rounded-full bg-muted-foreground"
            animate={reduced ? undefined : { opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
            transition={
              reduced
                ? undefined
                : { duration: 0.9, repeat: Number.POSITIVE_INFINITY, delay: i * 0.15 }
            }
          />
        ))}
      </span>
    </output>
  );
}
