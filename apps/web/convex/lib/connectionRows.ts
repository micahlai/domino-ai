import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { TOOL_IDS } from "../connectors/types";

/**
 * Connections rows after a read of the tools (shared by connections.sync and the field ingest,
 * so the Connect page shows what the last read actually did).
 */
export const toolArg = v.union(...TOOL_IDS.map((t) => v.literal(t)));

export const toolResult = v.object({
  tool: toolArg,
  error: v.union(v.string(), v.null()),
  cursor: v.union(v.string(), v.null()),
  counts: v.record(v.string(), v.number()),
  recordsIn: v.number(),
  recordsOut: v.number(),
  skipped: v.number(),
  checksOk: v.number(),
  checksTotal: v.number(),
});

export type ToolResult = typeof toolResult.type;

export async function storeToolResults(
  ctx: Pick<MutationCtx, "db">,
  companyId: Id<"companies">,
  at: string,
  results: ToolResult[],
) {
  for (const r of results) {
    const row = await ctx.db
      .query("connections")
      .withIndex("by_companyId_and_tool", (q) => q.eq("companyId", companyId).eq("tool", r.tool))
      .unique();
    // A tool disconnected while the read ran stays disconnected.
    if (!row || row.status === "disconnected") continue;
    const { tool: _t, error, ...rest } = r;
    await ctx.db.patch("connections", row._id, {
      ...rest,
      status: error ? "error" : "connected",
      lastSyncAt: at,
      lastError: error,
    });
  }
}
