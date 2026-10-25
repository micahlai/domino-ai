import type { WithoutSystemFields } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** Validator for one AgentRow passed from an action to a mutation. */
export const agentRowArg = v.object({
  action: v.string(),
  agentId: v.string(),
  agentKind: v.union(
    v.literal("domino"),
    v.literal("claude"),
    v.literal("creao"),
    v.literal("system"),
  ),
  parentAgentId: v.optional(v.string()),
  summary: v.string(),
  refs: v.optional(v.array(v.string())),
  event: v.union(v.literal("status"), v.literal("message"), v.literal("tool")),
  status: v.optional(
    v.union(v.literal("spawned"), v.literal("working"), v.literal("done"), v.literal("failed")),
  ),
  currentTask: v.optional(v.string()),
  fromAgentId: v.optional(v.string()),
  toAgentId: v.optional(v.string()),
  tool: v.optional(v.string()),
  toolCategory: v.optional(v.string()),
  toolLabel: v.optional(v.string()),
  source: v.optional(v.string()),
  step: v.optional(v.number()),
  steps: v.optional(v.number()),
});

/**
 * One `log` row for the Field agent web. Base fields match fieldJobs.writeLog; the agent
 * fields are additive and optional. `agent` repeats agentId so older readers still group rows.
 */
export type AgentKind = "domino" | "claude" | "creao" | "system";
export type AgentStatus = "spawned" | "working" | "done" | "failed";
export type AgentRow = {
  action: string;
  agentId: string;
  agentKind: AgentKind;
  parentAgentId?: string;
  summary: string;
  refs?: string[];
  event: "status" | "message" | "tool";
  status?: AgentStatus;
  currentTask?: string;
  fromAgentId?: string;
  toAgentId?: string;
  tool?: string;
  toolCategory?: string;
  toolLabel?: string;
  source?: string;
  step?: number;
  steps?: number;
};

export async function agentLog(
  ctx: Pick<MutationCtx, "db">,
  companyId: Id<"companies">,
  runId: string,
  row: AgentRow,
) {
  const { refs, summary, agentKind, ...rest } = row;
  const defined = Object.fromEntries(
    Object.entries(rest).filter(([, value]) => value !== undefined),
  ) as Omit<AgentRow, "refs" | "summary" | "agentKind">;
  const doc: WithoutSystemFields<Doc<"log">> = {
    companyId,
    actor: agentKind === "system" ? "connector" : "engine",
    refs: (refs ?? []).slice(0, 64),
    at: new Date().toISOString(),
    agent: row.agentId,
    runId,
    agentKind,
    summary: summary.slice(0, 500),
    ...defined,
    ...(row.currentTask && { currentTask: row.currentTask.slice(0, 200) }),
  };
  await ctx.db.insert("log", doc);
}
