import { v } from "convex/values";
import { internalAction } from "./_generated/server";

/** E7 replaces these placeholders with calls to the pure engine. */
export const recompute = internalAction({
  args: { companyId: v.id("companies") },
  handler: async (): Promise<never> => {
    throw new Error("not built");
  },
});
export const addEvent = internalAction({
  args: { companyId: v.id("companies"), label: v.string(), changes: v.array(v.any()) },
  handler: async (): Promise<never> => {
    throw new Error("not built");
  },
});
export const simulateFix = internalAction({
  args: { branchId: v.string(), fixId: v.string() },
  handler: async (): Promise<never> => {
    throw new Error("not built");
  },
});
