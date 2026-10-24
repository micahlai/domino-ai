import { defineConfig } from "vitest/config";

// Only the manual smoke; the default config never matches scripts/.
export default defineConfig({
  test: {
    include: ["scripts/manual-smoke.ts"],
    // Above the CREAO run deadline, so the transport's own bound reports the failure.
    testTimeout: 240_000,
  },
});
