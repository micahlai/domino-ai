import { v } from "convex/values";
import { internalAction } from "./_generated/server";

/** E5/E7 owns the implementation behind this scheduled entry point. */
export const run = internalAction({
  args: { companyId: v.id("companies") },
  handler: async (): Promise<never> => {
    throw new Error("not built");
  },
});
