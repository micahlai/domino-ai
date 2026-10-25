import type { Snapshot } from "@domino/contracts";
import { createMockHandler } from "@domino/mocks";
import type { Fetcher } from "./types";

/**
 * Fetcher over the in-process mock handler: requests never leave the process, so no real
 * vendor is ever reached. The key only satisfies the mock's own header check; not a secret.
 */
const IN_PROCESS_KEY = "in-process-mock";

export function inProcessFetcher(snapshot: Snapshot): Fetcher {
  const handler = createMockHandler({ apiKey: IN_PROCESS_KEY, snapshot: () => snapshot });
  return (path) =>
    handler(new Request(`http://mocks.local${path}`, { headers: { "x-api-key": IN_PROCESS_KEY } }));
}
