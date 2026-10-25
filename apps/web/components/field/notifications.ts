import type { FieldNotificationEvent } from "../../convex/fieldNotifications";
import { fieldTraceHref, timelineCalculationHref } from "../../lib/trace-links";
import { fixSentence } from "./worker/suggestions";

/** One toast: a short title, one line, and where "Open" goes. */
export type Toast = { key: string; title: string; line: string; href: string };

export type Rating = "ok" | "watch" | "at_risk";
export const RATING_LABEL: Record<Rating, string> = {
  ok: "On track",
  watch: "Watch",
  at_risk: "At risk",
};

/** Same DOM ids as the Worker page cards, so "Open" lands on the exact card. */
export const suggestionDomId = (id: string) => `suggestion-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
export const flagDomId = (id: string) => `flag-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
export const fixesDomId = (scenarioId: string) =>
  `fixes-${scenarioId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
export const riskDomId = (id: string) => `risk-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

const oneLine = (text: string, max = 90) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

export function eventToast(e: FieldNotificationEvent, companyId: string): Toast {
  switch (e.kind) {
    case "suggestion":
      return {
        key: e.key,
        title: "New suggestion",
        line: oneLine(fixSentence({ kind: e.fixKind, label: e.label })),
        href: `/field#${suggestionDomId(e.suggestionId)}`,
      };
    case "flag":
      return {
        key: e.key,
        title: "High-priority flag",
        line: oneLine(e.summary || "The audit agent found an odd entry."),
        href: `/field#${flagDomId(e.findingId)}`,
      };
    case "agents":
      return {
        key: e.key,
        title: "Agents finished",
        line: oneLine(
          e.summary ||
            `Checked ${e.children} ${e.children === 1 ? "scenario" : "scenarios"} on the latest books.`,
        ),
        href: fieldTraceHref({ companyId, runId: e.runId }),
      };
    case "run":
      return {
        key: e.key,
        title: e.runKind === "rules" ? "New rules saved" : "New simulation saved",
        line: oneLine(e.label || "A what-if was saved."),
        href: timelineCalculationHref(e.worldId, e.runId),
      };
  }
}

export function verdictToast(from: Rating, to: Rating, at: number): Toast {
  return {
    key: `verdict:${from}:${to}:${at}`,
    title: "Cash verdict changed",
    line: `Now ${RATING_LABEL[to]}, was ${RATING_LABEL[from]}.`,
    href: "/",
  };
}

/**
 * Which events are new since the last read. The first read after page open (or a company
 * switch) only records what exists, so history never toasts.
 */
export function freshEvents(
  events: FieldNotificationEvent[],
  seen: Set<string>,
  primed: boolean,
): FieldNotificationEvent[] {
  const fresh = events.filter((e) => !seen.has(e.key));
  for (const e of events) seen.add(e.key);
  return primed ? fresh.reverse() : [];
}
