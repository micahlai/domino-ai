import { inProcessFetcher } from "../../convex/connectors/inProcess";
import { pullAll } from "../../convex/connectors/pullAll";
import type { ToolId } from "../../convex/connectors/types";
import { emptyOverlay, newWorld, servedSnapshot } from "../../convex/fieldFeed";
import { type ExcludedReport, groupSkips } from "./connect-excluded";

// Demo only, loaded on demand: the excluded-record reasons for the recorded demo run. It is the
// same pullAll over the same mock company (sim Kestrel, seed 1) that recorded connect-demo.json
// (see convex/tests/connectors/demo.test.ts), so the counts match the cards exactly.

export async function demoExcluded(tools: ToolId[]): Promise<ExcludedReport> {
  const s = servedSnapshot(newWorld(1), emptyOverlay());
  const r = await pullAll({
    fetcher: inProcessFetcher(s),
    companyId: s.companyId,
    connections: tools.map((tool) => ({ tool, status: "connected" as const })),
  });
  return r.log.map((receipt) => ({ tool: receipt.tool, reasons: groupSkips(receipt.skipped) }));
}
