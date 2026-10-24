import { v } from "convex/values";
import { internalAction } from "./_generated/server";

/** E7 replaces these placeholders with validated agent calls and engine scoring. */
export const proposeFixes = internalAction({
  args: { branchId: v.string() },
  handler: async (): Promise<never> => {
    throw new Error("not built");
  },
});
export const explain = internalAction({
  args: { branchId: v.string() },
  handler: async (): Promise<never> => {
    throw new Error("not built");
  },
});
