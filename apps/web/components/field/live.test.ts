import { describe, expect, it } from "vitest";
import { buildBrainGraph, pulsePath } from "./graph";
import { type LiveLogRow, type LiveStatus, toOperations, toStatus } from "./live";

let n = 0;
const row = (over: Partial<LiveLogRow> & { action: string }): LiveLogRow =>
  ({
    _id: `log_${++n}`,
    _creationTime: n,
    companyId: "c1",
    at: `2026-10-30T10:00:${String(n).padStart(2, "0")}Z`,
    actor: "connector",
    refs: [],
    ...over,
  }) as LiveLogRow;

describe("live log mapping", () => {
  it("maps a real ingest run to source -> ingestion -> audit -> output on the brain map", () => {
    const rows = [
      row({ action: "ingest.started", agent: "field.ingest", runId: "r1", refs: ["manual"] }),
      row({
        action: "ingest.pulled",
        agent: "field.ingest",
        tool: "mock.cards.list",
        source: "ramp",
        runId: "r1",
      }),
      row({
        action: "audit.escalated",
        actor: "engine",
        agent: "field.audit",
        tool: "engine.auditSnapshot",
        runId: "r1",
        summary: "Card spike",
      }),
    ].reverse(); // field.log is newest first
    const ops = toOperations(rows);
    expect(ops.map((o) => o.kind)).toEqual(["run", "pull", "audit"]);
    expect(ops[0]?.status).toBe("running");
    expect(ops[1]).toMatchObject({ agent: "Ingestion agent", source: "cards" });
    expect(ops[2]).toMatchObject({ agent: "Audit agent", parentId: ops[0]?.id });
    const graph = buildBrainGraph(ops);
    expect(graph.edges.map((e) => e.id)).toEqual(
      expect.arrayContaining([
        "source:cards->agent:ingestion",
        "agent:ingestion->tool:mock.cards.list",
        "agent:ingestion->agent:audit",
        "agent:audit->tool:engine.auditsnapshot",
      ]),
    );
    expect(pulsePath(ops[2] as (typeof ops)[number], graph)).toEqual([
      "agent:ingestion->agent:audit",
      "agent:audit->output:flags",
    ]);
    expect(ops[2]?.actor).toBe("engine");
  });

  it("puts the Connect page's tools on the same vendor nodes as the mock feed", () => {
    const rows = ["qbo", "gusto", "hubspot", "plaid"].map((tool) =>
      row({
        action: "connections.connected",
        actor: "person",
        agent: "field.ingest",
        tool: `${tool}.consent`,
        source: tool,
      }),
    );
    const sources = toOperations(rows).map((o) => o.source);
    expect(sources).toEqual(["books", "payroll", "crm", "plaid"]);
    const graph = buildBrainGraph(toOperations(rows));
    expect(graph.nodes.find((n) => n.id === "source:plaid")).toMatchObject({
      title: "Plaid",
      vendor: "plaid",
    });
  });

  it("marks failures and reads lastAdvanceAt from the feed log", () => {
    const rows = [
      row({ action: "feed.advanced", agent: "mock.feed", at: "2026-10-30T09:00:00Z" }),
      row({ action: "ingest.failed", agent: "field.ingest" }),
    ];
    expect(toOperations(rows).map((o) => o.status)).toEqual(["succeeded", "failed"]);
    const status = {
      auto: true,
      lastIngestAt: "2026-10-30T10:00:00Z",
      lastIngestStatus: "failed",
      lastError: "boom",
      snapshotVersion: 2,
      openFindings: 3,
      openEscalations: 1,
      asOf: "2026-11-02",
      week: 5,
      sources: [{ lastPull: "2026-11-02" }, { lastPull: null }],
    } as unknown as LiveStatus;
    expect(toStatus(status, rows)).toMatchObject({
      feed: { lastAdvanceAt: "2026-10-30T09:00:00Z" },
      ingest: { enabled: true, lastStatus: "failed" },
      counts: { sources: 1, snapshots: 2, openFindings: 3 },
      lastError: "boom",
    });
  });
});
