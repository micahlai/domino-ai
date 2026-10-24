import { BranchSchema } from "@domino/contracts";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Approval, Timestamp, parse } from "./lib/parse";
import {
  candidateRecord,
  missing,
  newestFirst,
  recordPersonAction,
  requireBranch,
  sameChanges,
} from "./lib/records";

export const list = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const rows = await ctx.db
      .query("approvals")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .collect();
    for (const row of rows) {
      parse(Approval, row);
      parse(Timestamp, row.at);
    }
    return rows.sort(newestFirst);
  },
});

export const decide = mutation({
  args: {
    fixId: v.string(),
    branchId: v.string(),
    decision: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const input = parse(Approval, args);
    const branch = await requireBranch(ctx, input.branchId);
    if (branch.data.kind !== "fix" || !branch.data.parentId) {
      throw new ConvexError({
        code: "INVALID_DECISION",
        message: "Simulate this fix before deciding",
      });
    }
    const parent = await requireBranch(ctx, branch.data.parentId);
    const candidate = await candidateRecord(ctx, parent.data.id, input.fixId);
    if (
      !candidate ||
      candidate.row.companyId !== branch.row.companyId ||
      parent.row.companyId !== branch.row.companyId ||
      !sameChanges(candidate.fix.changes, branch.data.changes)
    ) {
      missing("Fix does not match this simulated future");
    }
    const identity = await ctx.auth.getUserIdentity();
    const by = identity?.tokenIdentifier ?? "demo-user (unverified)";
    const at = new Date().toISOString();
    const approvalId = await ctx.db.insert("approvals", {
      companyId: branch.row.companyId,
      fixId: input.fixId,
      branchId: input.branchId,
      decision: input.decision,
      by,
      at,
      note: input.note ?? "",
    });
    await ctx.db.patch(branch.row._id, {
      data: parse(BranchSchema, { ...branch.data, status: input.decision }),
    });
    await recordPersonAction(
      ctx,
      branch.row.companyId,
      `fix.${input.decision}`,
      [input.fixId, input.branchId],
      at,
    );
    return approvalId;
  },
});
