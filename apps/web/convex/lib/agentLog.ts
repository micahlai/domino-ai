import type { WithoutSystemFields } from "convex/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

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
