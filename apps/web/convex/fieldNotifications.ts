/**
 * Notifications (public, read-only). One reactive query over existing tables so the app shell
 * can toast important events for the selected company. Nothing is written here.
 *
 * Queries
 *   fieldNotifications.recent({ companyId, since })   since = wall-clock ms
 *     -> { rating: "ok"|"watch"|"at_risk"|null,
 *          events: [{ key, kind, at, ... }] }  newest first, at most ~40.
 *     kind "suggestion": a new suggestion row       { suggestionId, scenarioId, label, fixKind, scenarioTitle }
 *     kind "flag":       a new high-severity flag   { findingId, summary }
 *     kind "agents":     an analyst run finished    { runId, summary, children }
 *     kind "run":        a saved Timeline what-if   { runId, label, worldId, runKind }
 *   The cash verdict is the current dashboard rating; the client toasts when it changes.
 */
import { v } from "convex/values";
import { query } from "./_generated/server";

export type FieldNotificationEvent =
  | {
      key: string;
      kind: "suggestion";
      at: number;
      suggestionId: string;
      scenarioId: string;
      scenarioTitle: string;
      label: string;
      fixKind: string;
    }
  | { key: string; kind: "flag"; at: number; findingId: string; summary: string }
  | { key: string; kind: "agents"; at: number; runId: string; summary: string; children: number }
  | {
      key: string;
      kind: "run";
      at: number;
      runId: string;
      label: string;
      worldId: string;
      runKind: string;
    };

export const recent = query({
  args: { companyId: v.id("companies"), since: v.number() },
  handler: async (ctx, { companyId, since }) => {
    const events: FieldNotificationEvent[] = [];

    const suggestions = await ctx.db
      .query("suggestions")
      .withIndex("by_companyId_and_updatedAt", (q) => q.eq("companyId", companyId))
      .order("desc")
      .take(20);
    for (const s of suggestions)
      if (s._creationTime > since && s.status === "open")
        events.push({
          key: `suggestion:${s.suggestionId}:${s._creationTime}`,
          kind: "suggestion",
          at: s._creationTime,
          suggestionId: s.suggestionId,
          scenarioId: s.scenarioId,
          scenarioTitle: s.scenarioTitle,
          label: s.fix.label,
          fixKind: s.fix.kind,
        });

    const findings = await ctx.db
      .query("findings")
      .withIndex("by_companyId_and_status", (q) =>
        q.eq("companyId", companyId).eq("status", "open"),
      )
      .order("desc")
      .take(20);
    for (const f of findings)
      if (f._creationTime > since && f.severity === "high")
        events.push({
          key: `flag:${f.findingId}`,
          kind: "flag",
          at: f._creationTime,
          findingId: f.findingId,
          summary: f.summary,
        });

    const runs = await ctx.db
      .query("analystRuns")
      .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
      .order("desc")
      .take(5);
    for (const r of runs) {
      const done = r.finishedAt ? Date.parse(r.finishedAt) : Number.NaN;
      if (r.status === "done" && done > since)
        events.push({
          key: `agents:${r.runId}`,
          kind: "agents",
          at: done,
          runId: r.runId,
          summary: r.summary ?? "",
          children: r.children,
        });
    }

    const company = await ctx.db.get("companies", companyId);
    const demo = company?.operatingDemo;
    if (demo) {
      const worldId = `operating/${demo.company}/${demo.scenario}`;
      const saved = await ctx.db
        .query("timelineRuns")
        .withIndex("by_company", (q) => q.eq("companyId", worldId))
        .order("desc")
        .take(10);
      for (const t of saved)
        if (t._creationTime > since && t.kind !== "baseline")
          events.push({
            key: `run:${t.runId}`,
            kind: "run",
            at: t._creationTime,
            runId: t.runId,
            label: t.label,
            worldId,
            runKind: t.kind,
          });
    }

    const clock = await ctx.db
      .query("simClocks")
      .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
      .unique();
    const rating = clock?.lastRating ?? null;

    events.sort((a, b) => b.at - a.at);
    return {
      rating: rating === "ok" || rating === "watch" || rating === "at_risk" ? rating : null,
      events: events.slice(0, 40),
    };
  },
});
