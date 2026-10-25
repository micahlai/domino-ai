import type { AgentRow } from "./agentLog";

/**
 * Agent swarms (audit checkers, forecasters, advisors): one lead agent starts several helper
 * agents that work in parallel, each its own Convex function run, and the lead merges what they
 * report. Shared here: the bound on how many helpers run at once, the bounded fan-out, and the
 * lifecycle rows every helper writes (spawned -> working -> done | failed, parentAgentId = lead),
 * so the brain map draws every swarm the same way.
 *
 * Swarms are used only where helpers do distinct, independent work: the audit (one check each),
 * forecasting (one scenario each) and the advisors (one candidate fix each, only when a scenario
 * breaks the lender's minimum).
 */

/** Helpers of one swarm running at the same time. */
export const SWARM_LIMIT = 4;

/**
 * Runs `work` over `items` with at most `limit` in flight; results keep the input order. A
 * failed item rejects only its own slot (Promise.allSettled shape), never the others.
 */
export async function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = { status: "fulfilled", value: await work(items[i] as T, i) };
      } catch (reason) {
        out[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  return out;
}

type Body = Omit<
  AgentRow,
  "agentId" | "agentKind" | "parentAgentId" | "event" | "status" | "action"
> & { action?: string };

/** Lifecycle rows of one helper agent under its lead. */
export function member(agentId: string, lead: string, agentKind: AgentRow["agentKind"] = "domino") {
  const row = (r: Omit<AgentRow, "agentId" | "agentKind" | "parentAgentId">): AgentRow => ({
    agentId,
    agentKind,
    parentAgentId: lead,
    ...r,
  });
  return {
    spawned: (b: Body): AgentRow =>
      row({ action: "agent.spawned", ...b, event: "status", status: "spawned" }),
    working: (b: Body): AgentRow =>
      row({ action: "agent.working", ...b, event: "status", status: "working" }),
    done: (b: Body): AgentRow =>
      row({ action: "agent.done", ...b, event: "status", status: "done" }),
    failed: (b: Body): AgentRow =>
      row({ action: "agent.failed", ...b, event: "status", status: "failed" }),
    tool: (b: Body & { tool: string; toolCategory: string }): AgentRow =>
      row({ action: "agent.tool", ...b, event: "tool" }),
    /** Lead -> helper message (the assignment). */
    assigned: (summary: string, refs?: string[]): AgentRow => ({
      action: "agent.message",
      agentId: lead,
      agentKind: "domino",
      event: "message",
      fromAgentId: lead,
      toAgentId: agentId,
      summary,
      ...(refs && { refs }),
    }),
    /** Helper -> lead message (the report). */
    reported: (summary: string, refs?: string[]): AgentRow =>
      row({
        action: "agent.message",
        event: "message",
        fromAgentId: agentId,
        toAgentId: lead,
        summary,
        ...(refs && { refs }),
      }),
  };
}
