import {
  FIXTURE_NAMES,
  PINNED_FIXTURE_HASHES,
  fixtureText,
  verifyFixtureText,
} from "../../../lib/feature-boundary/verify";
import { Badge } from "../../ui/badge";
import { FieldBackendSmoke } from "./FieldBackendSmoke";

/** Case of the peer fixture seed (P0-C 2U fixture); the backend smoke reads this case. */
const PEER_SEED_CASE_ID = "twou-2023-cash-v1";

/** Field seam smoke test: export the labelled peer fixture seed as JSON text, with verification. */
export async function FieldSeamHarness() {
  const seedText = fixtureText("validTwoUSeed");
  const rows = await Promise.all(
    FIXTURE_NAMES.map(async (name) => ({
      name,
      result: await verifyFixtureText(name, fixtureText(name)),
    })),
  );
  return (
    <div className="space-y-6">
      <FieldBackendSmoke caseId={PEER_SEED_CASE_ID} />
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-dashed text-clay">
            Peer fixture
          </Badge>
          <a
            className="text-sm underline"
            download="timeline-seed-valid-2u.fixture.json"
            href={`data:application/json;charset=utf-8,${encodeURIComponent(seedText)}`}
          >
            Download TimelineSeedV1 JSON text
          </a>
        </div>
        <pre
          aria-label="Exported seed JSON text"
          className="max-h-64 overflow-auto rounded-md border p-2 font-mono text-xs"
        >
          {seedText}
        </pre>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-medium">Recomputed hashes (P0-C public fixtures)</h2>
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1 pr-4 font-normal">Fixture</th>
              <th className="py-1 pr-4 font-normal">Result</th>
              <th className="py-1 font-normal">Pinned fixture hash</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.map(({ name, result }) => (
              <tr key={name} data-testid={`fixture-${name}`}>
                <td className="py-1 pr-4">{name}</td>
                <td className="py-1 pr-4">
                  {result.ok ? "verified" : `rejected: ${result.reason}`}
                </td>
                <td className="py-1 break-all">{PINNED_FIXTURE_HASHES[name].fixtureHash}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-muted-foreground">
          mismatchedSeed is expected to be rejected. blockedSeed verifies here but is not
          forecast-ready, so the Timeline harness rejects it as forecast input.
        </p>
      </section>
    </div>
  );
}
