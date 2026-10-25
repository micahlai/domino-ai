import { canonicalJson } from "@domino/contracts";
import { ConvexError, v } from "convex/values";
import { action } from "../_generated/server";
import { projectOutput } from "./output/project";
import { CompanyIdSchema, RunIdSchema } from "./output/schema";
import { workspaceRefs } from "./workspaceRefs";

/** Proposed Timeline-owned financial read envelope; Field adoption is a separate joint gate. */
export const get = action({
  args: { companyId: v.string(), runId: v.string() },
  handler: async (ctx, args): Promise<string | null> => {
    if (
      !CompanyIdSchema.safeParse(args.companyId).success ||
      !RunIdSchema.safeParse(args.runId).success
    )
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Expected a company and saved workspace run",
      });
    const run = await ctx.runQuery(workspaceRefs.get, args);
    if (!run) return null;
    const graph = await ctx.runQuery(workspaceRefs.graph, {
      companyId: args.companyId,
      baselineRunId: run.baselineRunId,
    });
    return canonicalJson(
      await projectOutput(run, graph, args, (runId) =>
        ctx.runQuery(workspaceRefs.get, { companyId: args.companyId, runId }),
      ),
    );
  },
});
