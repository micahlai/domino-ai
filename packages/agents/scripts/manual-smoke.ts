/**
 * Manual live smoke for one provider job. Never part of `pnpm check`.
 *
 *   SMOKE_CONFIRM=live-provider-call SMOKE_JOB=mapSource SMOKE_BACKEND=creao \
 *     pnpm --filter @domino/agents smoke
 *
 * Credentials come only from the caller's environment. Output is one report line with
 * job, backend, status category and a size summary; no credentials, URLs or raw bodies.
 */
import { expect, it } from "vitest";
import { runSmoke } from "../src/smoke";

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } })
  .process.env;

it("runs one explicit provider job", async () => {
  const report = await runSmoke(env);
  console.log(`domino-agents-smoke ${JSON.stringify(report)}`);
  expect(report.ok, "smoke failed; see the domino-agents-smoke line").toBe(true);
});
