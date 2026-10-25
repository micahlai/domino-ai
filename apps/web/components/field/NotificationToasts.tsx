"use client";

import { type RequestForQueries, useQueries } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { ArrowUpRight, Bell, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import type { FieldNotificationEvent } from "../../convex/fieldNotifications";
import { useSelectedCompany } from "./company";
import { type Rating, type Toast, eventToast, freshEvents, verdictToast } from "./notifications";

const RECENT = makeFunctionReference<
  "query",
  { companyId: Id<"companies">; since: number },
  { rating: Rating | null; events: FieldNotificationEvent[] }
>("fieldNotifications:recent");

const MAX_VISIBLE = 3;
const DISMISS_MS = 6000;
/** Tolerates a client clock ahead of the server; the first read is never toasted anyway. */
const SKEW_MS = 60_000;

/** Bottom-right toasts for important events on the selected company, only after page open. */
export function NotificationToasts() {
  const { companyId } = useSelectedCompany();
  // A new company starts a fresh window: its history is read once and not toasted.
  const since = useMemo(() => (companyId ? Date.now() - SKEW_MS : 0), [companyId]);
  const queries = useMemo(() => {
    const request: RequestForQueries = {};
    if (companyId) request.recent = { query: RECENT, args: { companyId, since } };
    return request;
  }, [companyId, since]);
  const result = useQueries(queries).recent as
    | { rating: Rating | null; events: FieldNotificationEvent[] }
    | Error
    | undefined;
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seen = useRef<{
    company: string | null;
    keys: Set<string>;
    primed: boolean;
    rating: Rating | null;
  }>({
    company: null,
    keys: new Set(),
    primed: false,
    rating: null,
  });

  useEffect(() => {
    if (!companyId || !result || result instanceof Error) return;
    if (seen.current.company !== companyId) {
      seen.current = { company: companyId, keys: new Set(), primed: false, rating: null };
      setToasts([]);
    }
    const s = seen.current;
    const next = freshEvents(result.events, s.keys, s.primed).map((e) => eventToast(e, companyId));
    if (s.primed && s.rating && result.rating && result.rating !== s.rating)
      next.push(verdictToast(s.rating, result.rating, Date.now()));
    s.rating = result.rating ?? s.rating;
    s.primed = true;
    if (next.length > 0) setToasts((cur) => [...cur, ...next].slice(-MAX_VISIBLE));
  }, [companyId, result]);

  const dismiss = (key: string) => setToasts((cur) => cur.filter((t) => t.key !== key));

  return (
    <section
      aria-label="Notifications"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[360px]"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastCard key={t.key} toast={t} onDismiss={() => dismiss(t.key)} />
        ))}
      </AnimatePresence>
    </section>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const reduced = useReducedMotion();
  const [paused, setPaused] = useState(false);
  // Parent re-renders on every query update; the timer must not restart for those.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => dismissRef.current(), DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [paused]);
  return (
    <motion.div
      layout={!reduced}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
      transition={{ duration: reduced ? 0.1 : 0.2, ease: "easeOut" }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="pointer-events-auto flex w-full items-start gap-3 rounded-lg border bg-card px-4 py-3 text-card-foreground shadow-md"
    >
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Bell aria-hidden="true" className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-5">{toast.title}</p>
        <p
          className="mt-0.5 truncate text-[13px] leading-5 text-muted-foreground"
          title={toast.line}
        >
          {toast.line}
        </p>
        <Link
          href={toast.href}
          onClick={onDismiss}
          className="mt-1 inline-flex items-center gap-1 rounded text-[13px] font-medium text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Open
          <ArrowUpRight aria-hidden="true" className="size-3.5" />
        </Link>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={`Dismiss: ${toast.title}`}
        className="-mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </motion.div>
  );
}
