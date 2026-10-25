import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toolSummaries } from "../../connectors/catalog";
import { inProcessFetcher } from "../../connectors/inProcess";
import { pullAll } from "../../connectors/pullAll";
import { TOOL_IDS, type ToolId } from "../../connectors/types";
import { emptyOverlay, newWorld, servedSnapshot } from "../../fieldFeed";

// The connect page's demo mode shows these numbers. They are real pullAll results over the
// same mock company field.setup creates (sim Kestrel, seed 1), one per set of connected tools.
// Re-record: RECORD_CONNECTOR_FIXTURES=1 npx vitest run convex/tests/connectors
const FILE = new URL("../../../components/field/connect-demo.json", import.meta.url);

async function demoRuns() {
  const s = servedSnapshot(newWorld(1), emptyOverlay());
  const runs: Record<string, ReturnType<typeof toolSummaries>> = {};
  for (let mask = 1; mask < 1 << TOOL_IDS.length; mask++) {
    const tools = TOOL_IDS.filter((_, i) => mask & (1 << i)) as ToolId[];
    const r = await pullAll({
      fetcher: inProcessFetcher(s),
      companyId: s.companyId,
      connections: tools.map((tool) => ({ tool, status: "connected" })),
    });
    runs[[...tools].sort().join(",")] = toolSummaries(r).map((t) => ({ ...t, cursor: null }));
  }
  return { companyId: s.companyId, asOf: s.asOf, runs };
}

describe("connect page demo numbers", () => {
  it("match a fresh pullAll for every set of connected tools", async () => {
    const fresh = await demoRuns();
    if (process.env.RECORD_CONNECTOR_FIXTURES === "1") writeFileSync(FILE, JSON.stringify(fresh));
    expect(JSON.parse(readFileSync(FILE, "utf8"))).toEqual(fresh);
  }, 60_000);
});
