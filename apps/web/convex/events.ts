import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation } from "./_generated/server";
import { AddEvent, parse } from "./lib/parse";
import { requireCompany } from "./lib/records";

export const add = mutation({
  args: { companyId: v.id("companies"), label: v.string(), changes: v.array(v.any()) },
  handler: async (ctx, args): Promise<null> => {
    const input = parse(AddEvent, args);
    await requireCompany(ctx, args.companyId);
    await ctx.scheduler.runAfter(0, internal.engine.addEvent, {
      companyId: args.companyId,
      label: input.label,
      changes: input.changes,
    });
    return null;
  },
});
