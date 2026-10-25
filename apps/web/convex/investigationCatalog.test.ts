/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import {
  type PaginationOptions,
  type PaginationResult,
  makeFunctionReference,
} from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc } from "./_generated/dataModel";
import type { CatalogItem } from "./investigationCatalog";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "./_generated/*.js", "!./**/*.test.ts"]);
// Typed reference until the generated api registers this module (see the S2 card Result).
const list = makeFunctionReference<
  "query",
  { caseId: string; paginationOpts: PaginationOptions },
  PaginationResult<CatalogItem>
>("investigationCatalog:list");

const CASE_ID = "twou-2023-cash-v1";
const OTHER_CASE = "other-case-v1";

type Conversation = Omit<Doc<"investigationConversations">, "_id" | "_creationTime">;
type Operation = Omit<Doc<"investigationOperations">, "_id" | "_creationTime">;
type Run = Omit<Doc<"historicalRuns">, "_id" | "_creationTime">;
type Reveal = Omit<Doc<"historicalReveals">, "_id" | "_creationTime">;
type Kind = Operation["kind"];
type Status = Operation["status"];

// Server-only values that must never reach the catalog.
const SECRET = {
  packet: { prompt: "PACKET-SECRET" },
  profile: { instructions: "INSTRUCTIONS-SECRET" },
  remoteRunId: "REMOTE-RUN-SECRET",
  input: { hash: "INPUT-SECRET" },
  output: { assessment: "OUTPUT-SECRET", cents: 123456789 },
  error: { code: "boom", message: "ERROR-SECRET" },
};

const TITLES: Record<Kind, string> = {
  source_load: "Load curated archived disclosure",
  forecast: "Engine forecast (quarterly cash bridge)",
  specialist: "Evidence analyst",
  reveal: "Reveal next archived disclosure",
  alternative: "Engine alternative (costed response)",
};

function conversation(conversationId: string, createdAt: string, caseId = CASE_ID): Conversation {
  return { conversationId, caseId, question: `Question for ${conversationId}`, createdAt };
}

function op(
  conversationId: string,
  sequence: number,
  kind: Kind,
  status: Status,
  extra: Partial<Operation> = {},
): Operation {
  return {
    operationId: `${conversationId}-${sequence}`,
    conversationId,
    sequence,
    kind,
    title: TITLES[kind],
    status,
    dependsOn: [],
    createdAt: "2026-10-24T00:00:00.000Z",
    input: SECRET.input,
    output: SECRET.output,
    ...(status === "failed" || status === "unknown" ? { error: SECRET.error } : {}),
    ...(kind === "specialist"
      ? {
          role: "evidence_analyst" as const,
          packet: SECRET.packet,
          profile: SECRET.profile,
          remoteRunId: SECRET.remoteRunId,
          remoteStatus: "done",
        }
      : {}),
    ...extra,
  };
}

const runRef = (id: string) => ({ outputRef: { kind: "run", id } });

function baseline(conversationId: string, runId = `run-${conversationId}`): Run {
  return {
    runId,
    requestId: `inv:${conversationId}-2`,
    caseId: CASE_ID,
    kind: "baseline",
    owner: conversationId,
    run: { cash: SECRET.output.cents },
    snapshot: {},
    summary: {},
    rowHash: "hash",
  };
}

function alternative(conversationId: string, baselineRunId: string, runId: string): Run {
  return { ...baseline(conversationId, runId), kind: "alternative", baselineRunId };
}

function reveal(runId: string): Reveal {
  return {
    runId,
    requestId: `inv:${runId}-reveal`,
    revealedThrough: "2024-02-12",
    revealedAt: "2026-10-24T00:00:00.000Z",
    comparisons: [{ id: "c1", cents: SECRET.output.cents }],
  };
}

type Fixture = {
  conversations?: Conversation[];
  operations?: Operation[];
  runs?: Run[];
  reveals?: Reveal[];
};

async function setup(f: Fixture) {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (const c of f.conversations ?? []) await ctx.db.insert("investigationConversations", c);
    for (const o of f.operations ?? []) await ctx.db.insert("investigationOperations", o);
    for (const r of f.runs ?? []) await ctx.db.insert("historicalRuns", r);
    for (const r of f.reveals ?? []) await ctx.db.insert("historicalReveals", r);
  });
  return t;
}

type T = Awaited<ReturnType<typeof setup>>;

const page = (numItems: number, cursor: string | null = null) => ({
  caseId: CASE_ID,
  paginationOpts: { numItems, cursor },
});

async function only(t: T, conversationId: string) {
  const r = await t.query(list, page(25));
  const item = r.page.find((i) => i.conversationId === conversationId);
  if (!item) throw new Error(`missing ${conversationId}`);
  return item;
}

/** A finished forecast conversation: source, forecast (proven run), analyst. */
function forecastOps(id: string, analyst: Status = "succeeded"): Operation[] {
  return [
    op(id, 1, "source_load", "succeeded"),
    op(id, 2, "forecast", "succeeded", runRef(`run-${id}`)),
    op(id, 3, "specialist", analyst),
  ];
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response("unexpected", { status: 500 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("investigationCatalog.list scope and pagination", () => {
  it("returns only the exact case, newest first, with stable tie order", async () => {
    const t = await setup({
      conversations: [
        conversation("c-old", "2026-10-20T00:00:00.000Z"),
        conversation("c-tie-a", "2026-10-22T00:00:00.000Z"),
        conversation("c-tie-b", "2026-10-22T00:00:00.000Z"),
        conversation("c-new", "2026-10-23T00:00:00.000Z"),
        conversation("x-other", "2026-10-24T00:00:00.000Z", OTHER_CASE),
        conversation("x-prefix", "2026-10-24T00:00:00.000Z", `${CASE_ID}-extra`),
      ],
    });
    const all = await t.query(list, page(25));
    // Equal createdAt falls back to _creationTime desc, so the later insert comes first.
    expect(all.page.map((i) => i.conversationId)).toEqual(["c-new", "c-tie-b", "c-tie-a", "c-old"]);
    expect(all.isDone).toBe(true);

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const r: PaginationResult<CatalogItem> = await t.query(list, page(1, cursor));
      seen.push(...r.page.map((p) => p.conversationId));
      if (r.isDone) break;
      cursor = r.continueCursor;
    }
    expect(seen).toEqual(["c-new", "c-tie-b", "c-tie-a", "c-old"]);
    // A repeated page with the same cursor is identical.
    const first = await t.query(list, page(2));
    const again = await t.query(list, page(2));
    expect(again).toEqual(first);
    expect(first.page.map((i) => i.conversationId)).toEqual(["c-new", "c-tie-b"]);
  });

  it("rejects unknown cases without broadening scope", async () => {
    const t = await setup({ conversations: [conversation("x", "2026-10-24", OTHER_CASE)] });
    for (const caseId of [OTHER_CASE, "", CASE_ID.toUpperCase(), `${CASE_ID} `])
      await expect(
        t.query(list, { caseId, paginationOpts: { numItems: 5, cursor: null } }),
      ).rejects.toThrow(/Unknown case/);
  });

  it("rejects numItems outside integers 1..25", async () => {
    const t = await setup({});
    for (const n of [
      0,
      -1,
      26,
      1000,
      1.5,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ])
      await expect(t.query(list, page(n))).rejects.toThrow(/numItems must be an integer/);
    await expect(t.query(list, page(1))).resolves.toBeDefined();
    await expect(t.query(list, page(25))).resolves.toBeDefined();
  });

  it("fails closed when a native endCursor spans more than 25 rows", async () => {
    const ids = Array.from({ length: 27 }, (_, i) => `c${String(i).padStart(2, "0")}`);
    const t = await setup({
      conversations: ids.map((id, i) =>
        conversation(id, `2026-10-${String(i + 1).padStart(2, "0")}`),
      ),
      operations: ids.map((id) => op(id, 1, "source_load", "queued")),
    });
    const first = await t.query(list, page(25));
    const second = await t.query(list, page(1, first.continueCursor));
    expect(second.page).toHaveLength(1);
    // The 26th row's native cursor bounds a 26-row page despite numItems: 1.
    const span26 = { numItems: 1, cursor: null, endCursor: second.continueCursor };
    await expect(t.query(list, { caseId: CASE_ID, paginationOpts: span26 })).rejects.toThrow(
      /at most 25 items/,
    );
    // "_end_cursor" means the end of the range, so 27 rows.
    const toEnd = { numItems: 1, cursor: null, endCursor: "_end_cursor" };
    await expect(t.query(list, { caseId: CASE_ID, paginationOpts: toEnd })).rejects.toThrow(
      /at most 25 items/,
    );
  });

  it("keeps native endCursor behavior within the bound", async () => {
    const ids = Array.from({ length: 27 }, (_, i) => `c${String(i).padStart(2, "0")}`);
    const t = await setup({
      conversations: ids.map((id, i) =>
        conversation(id, `2026-10-${String(i + 1).padStart(2, "0")}`),
      ),
    });
    const two = await t.query(list, page(2));
    // A native end boundary returns the rows through it, even with numItems: 1.
    const bounded = await t.query(list, {
      caseId: CASE_ID,
      paginationOpts: { numItems: 1, cursor: null, endCursor: two.continueCursor },
    });
    expect(bounded.page.map((i) => i.conversationId)).toEqual(["c26", "c25"]);
    expect(bounded.page).toEqual(two.page);
    expect(bounded.continueCursor).toBe(two.continueCursor);
    // Exactly 25 rows through an end boundary is accepted.
    const full = await t.query(list, page(25));
    const at25 = await t.query(list, {
      caseId: CASE_ID,
      paginationOpts: { numItems: 3, cursor: null, endCursor: full.continueCursor },
    });
    expect(at25.page).toHaveLength(25);
    expect(at25.page).toEqual(full.page);
  });

  it("returns an empty page for an empty case", async () => {
    const t = await setup({});
    const r = await t.query(list, page(10));
    expect(r.page).toEqual([]);
    expect(r.isDone).toBe(true);
  });

  it("ignores unrelated operations and runs from other conversations", async () => {
    const t = await setup({
      conversations: [
        conversation("c1", "2026-10-21"),
        conversation("x1", "2026-10-21", OTHER_CASE),
      ],
      operations: [
        ...forecastOps("c1"),
        op("x1", 1, "source_load", "running"),
        op("x1", 2, "forecast", "unknown"),
      ],
      runs: [baseline("c1")],
    });
    const r = await t.query(list, page(25));
    expect(r.page).toHaveLength(1);
    expect(r.page[0]!.status).toBe("completed");
  });
});

describe("investigationCatalog.list statuses", () => {
  const cases: { name: string; ops: (id: string) => Operation[]; status: string }[] = [
    { name: "all succeeded", ops: (id) => forecastOps(id), status: "completed" },
    {
      name: "queued work",
      ops: (id) => [op(id, 1, "source_load", "queued"), op(id, 2, "forecast", "queued")],
      status: "running",
    },
    {
      name: "running beats unknown and failed",
      ops: (id) => [
        op(id, 1, "source_load", "failed"),
        op(id, 2, "forecast", "unknown"),
        op(id, 3, "specialist", "running"),
      ],
      status: "running",
    },
    {
      name: "unknown plus failed stays unknown",
      ops: (id) => [...forecastOps(id, "unknown"), op(id, 4, "alternative", "failed")],
      status: "unknown",
    },
    {
      name: "saved forecast plus failed specialist is partial",
      ops: (id) => forecastOps(id, "failed"),
      status: "partial",
    },
    {
      name: "no saved output and failures is failed",
      ops: (id) => [
        op(id, 1, "source_load", "succeeded"),
        op(id, 2, "forecast", "failed"),
        op(id, 3, "specialist", "failed"),
      ],
      status: "failed",
    },
    { name: "empty operations", ops: () => [], status: "unknown" },
  ];

  for (const c of cases)
    it(c.name, async () => {
      const t = await setup({
        conversations: [conversation("c1", "2026-10-21")],
        operations: c.ops("c1"),
        runs: [baseline("c1")],
      });
      const item = await only(t, "c1");
      expect(item.status).toBe(c.status);
    });

  it("an empty conversation is never completed and has no saved ids", async () => {
    const t = await setup({ conversations: [conversation("c1", "2026-10-21")] });
    expect(await only(t, "c1")).toEqual({
      conversationId: "c1",
      question: "Question for c1",
      createdAt: "2026-10-21",
      status: "unknown",
      operationsComplete: true,
      currentOperation: null,
      forecastRunId: null,
      alternativeRunId: null,
      revealed: false,
    });
  });

  it("current operation prefers running, then queued, unknown, failed, else last", async () => {
    const t = await setup({
      conversations: [
        conversation("run", "1"),
        conversation("unk", "2"),
        conversation("fail", "3"),
        conversation("done", "4"),
      ],
      operations: [
        op("run", 1, "source_load", "succeeded"),
        op("run", 2, "forecast", "queued"),
        op("run", 3, "specialist", "running"),
        ...forecastOps("unk", "unknown"),
        ...forecastOps("fail", "failed"),
        ...forecastOps("done"),
      ],
      runs: [baseline("unk"), baseline("fail"), baseline("done")],
    });
    expect((await only(t, "run")).currentOperation).toEqual({
      title: TITLES.specialist,
      kind: "specialist",
      status: "running",
    });
    expect((await only(t, "unk")).currentOperation?.status).toBe("unknown");
    expect((await only(t, "fail")).currentOperation?.status).toBe("failed");
    expect((await only(t, "done")).currentOperation).toEqual({
      title: TITLES.specialist,
      kind: "specialist",
      status: "succeeded",
    });
  });
});

describe("investigationCatalog.list bounded operation reads", () => {
  it("accepts exactly the bound and fails closed past it", async () => {
    const atBound = Array.from({ length: 8 }, (_, i) =>
      op("c8", i + 1, "source_load", "succeeded"),
    );
    // Rows past the bound hide a queued step, an unknown step and a failure.
    const past = [
      ...forecastOps("c9"),
      ...Array.from({ length: 5 }, (_, i) => op("c9", i + 4, "source_load", "succeeded")),
      op("c9", 9, "specialist", "queued"),
      op("c9", 10, "specialist", "unknown"),
      op("c9", 11, "alternative", "failed"),
    ];
    const t = await setup({
      conversations: [conversation("c8", "1"), conversation("c9", "2")],
      operations: [...atBound, ...past],
      runs: [baseline("c9")],
    });
    const ok = await only(t, "c8");
    expect(ok.operationsComplete).toBe(true);
    expect(ok.status).toBe("completed");

    expect(await only(t, "c9")).toEqual({
      conversationId: "c9",
      question: "Question for c9",
      createdAt: "2",
      status: "unknown",
      operationsComplete: false,
      currentOperation: null,
      forecastRunId: null,
      alternativeRunId: null,
      revealed: false,
    });
  });
});

describe("investigationCatalog.list saved outputs", () => {
  it("exposes only the allowlist with proven forecast, alternative and reveal", async () => {
    const id = "c1";
    const t = await setup({
      conversations: [conversation(id, "2026-10-21")],
      operations: [
        ...forecastOps(id),
        op(id, 4, "reveal", "succeeded", { outputRef: { kind: "reveal", id: `run-${id}` } }),
        op(id, 5, "alternative", "succeeded", runRef("alt-1")),
        op(id, 6, "specialist", "succeeded", {
          role: "scenario_reviewer",
          title: "Scenario reviewer",
        }),
      ],
      runs: [baseline(id), alternative(id, `run-${id}`, "alt-1")],
      reveals: [reveal(`run-${id}`)],
    });
    const r = await t.query(list, page(5));
    expect(r.page).toEqual([
      {
        conversationId: id,
        question: "Question for c1",
        createdAt: "2026-10-21",
        status: "completed",
        operationsComplete: true,
        currentOperation: { title: "Scenario reviewer", kind: "specialist", status: "succeeded" },
        forecastRunId: `run-${id}`,
        alternativeRunId: "alt-1",
        revealed: true,
      },
    ]);
    const text = JSON.stringify(r);
    for (const secret of [
      "PACKET-SECRET",
      "INSTRUCTIONS-SECRET",
      "REMOTE-RUN-SECRET",
      "INPUT-SECRET",
      "OUTPUT-SECRET",
      "123456789",
      "evidence_analyst",
      "rowHash",
    ])
      expect(text).not.toContain(secret);
  });

  it("does not treat failed attempts as saved runs or reveals", async () => {
    const id = "c1";
    const t = await setup({
      conversations: [conversation(id, "2026-10-21")],
      operations: [
        op(id, 1, "source_load", "succeeded"),
        op(id, 2, "forecast", "failed", runRef(`run-${id}`)),
        op(id, 3, "reveal", "failed", { outputRef: { kind: "reveal", id: `run-${id}` } }),
        op(id, 4, "alternative", "failed", runRef("alt-1")),
      ],
      // Rows exist, but no succeeded operation claims them.
      runs: [baseline(id), alternative(id, `run-${id}`, "alt-1")],
      reveals: [reveal(`run-${id}`)],
    });
    const item = await only(t, id);
    expect(item).toMatchObject({
      status: "failed",
      forecastRunId: null,
      alternativeRunId: null,
      revealed: false,
    });
  });

  it("partial keeps the proven forecast but no failed alternative", async () => {
    const id = "c1";
    const t = await setup({
      conversations: [conversation(id, "2026-10-21")],
      operations: [...forecastOps(id), op(id, 4, "alternative", "failed", runRef("alt-1"))],
      runs: [baseline(id), alternative(id, `run-${id}`, "alt-1")],
    });
    expect(await only(t, id)).toMatchObject({
      status: "partial",
      forecastRunId: `run-${id}`,
      alternativeRunId: null,
      revealed: false,
    });
  });

  const malformed: { name: string; fixture: (id: string) => Fixture }[] = [
    {
      name: "forecast ref of the wrong kind",
      fixture: (id) => ({
        operations: [
          op(id, 1, "source_load", "succeeded"),
          op(id, 2, "forecast", "succeeded", { outputRef: { kind: "reveal", id: `run-${id}` } }),
        ],
        runs: [baseline(id)],
      }),
    },
    {
      name: "forecast ref to a missing run",
      fixture: (id) => ({
        operations: [op(id, 1, "forecast", "succeeded", runRef("arbitrary-id"))],
        runs: [],
      }),
    },
    {
      name: "forecast ref with an empty id",
      fixture: (id) => ({ operations: [op(id, 1, "forecast", "succeeded", runRef(""))], runs: [] }),
    },
    {
      name: "forecast without any ref",
      fixture: (id) => ({ operations: [op(id, 1, "forecast", "succeeded")], runs: [baseline(id)] }),
    },
    {
      name: "forecast ref to another conversation's run",
      fixture: (id) => ({
        operations: [op(id, 1, "forecast", "succeeded", runRef("run-other"))],
        runs: [baseline("other")],
      }),
    },
    {
      name: "forecast ref to an alternative run",
      fixture: (id) => ({
        operations: [op(id, 1, "forecast", "succeeded", runRef("alt-1"))],
        runs: [alternative(id, "run-x", "alt-1")],
      }),
    },
    {
      name: "forecast ref to a run on another case",
      fixture: (id) => ({
        operations: [op(id, 1, "forecast", "succeeded", runRef(`run-${id}`))],
        runs: [{ ...baseline(id), caseId: OTHER_CASE }],
      }),
    },
    {
      name: "two succeeded forecasts",
      fixture: (id) => ({
        operations: [
          op(id, 1, "forecast", "succeeded", runRef(`run-${id}`)),
          op(id, 2, "forecast", "succeeded", runRef(`run-${id}`)),
        ],
        runs: [baseline(id)],
      }),
    },
  ];

  for (const m of malformed)
    it(`fails closed on ${m.name}`, async () => {
      const id = "c1";
      const t = await setup({ conversations: [conversation(id, "2026-10-21")], ...m.fixture(id) });
      expect(await only(t, id)).toMatchObject({
        status: "unknown",
        forecastRunId: null,
        alternativeRunId: null,
        revealed: false,
      });
    });

  it("fails closed on a reveal or alternative that cannot be proven", async () => {
    const t = await setup({
      conversations: [
        conversation("rev-wrong", "1"),
        conversation("rev-missing", "2"),
        conversation("alt-wrong-base", "3"),
        conversation("alt-kind", "4"),
      ],
      operations: [
        ...forecastOps("rev-wrong"),
        op("rev-wrong", 4, "reveal", "succeeded", { outputRef: { kind: "reveal", id: "run-x" } }),
        ...forecastOps("rev-missing"),
        op("rev-missing", 4, "reveal", "succeeded", {
          outputRef: { kind: "reveal", id: "run-rev-missing" },
        }),
        ...forecastOps("alt-wrong-base"),
        op("alt-wrong-base", 4, "alternative", "succeeded", runRef("alt-w")),
        ...forecastOps("alt-kind"),
        op("alt-kind", 4, "alternative", "succeeded", {
          outputRef: { kind: "reveal", id: "alt-k" },
        }),
      ],
      runs: [
        baseline("rev-wrong"),
        baseline("rev-missing"),
        baseline("alt-wrong-base"),
        alternative("alt-wrong-base", "run-elsewhere", "alt-w"),
        baseline("alt-kind"),
        alternative("alt-kind", "run-alt-kind", "alt-k"),
      ],
      reveals: [reveal("run-x")],
    });
    for (const id of ["rev-wrong", "rev-missing", "alt-wrong-base", "alt-kind"]) {
      const item = await only(t, id);
      expect(item.status, id).toBe("unknown");
      expect(item.forecastRunId, id).toBe(`run-${id}`);
      expect(item.alternativeRunId, id).toBeNull();
      expect(item.revealed, id).toBe(false);
    }
  });
});

describe("investigationCatalog.list is read-only", () => {
  it("repeated reads cause no writes, scheduled work or provider calls", async () => {
    const t = await setup({
      conversations: [conversation("c1", "1"), conversation("c2", "2")],
      operations: [
        ...forecastOps("c1"),
        op("c2", 1, "source_load", "queued"),
        op("c2", 2, "specialist", "running", { leaseUntil: 0 }),
      ],
      runs: [baseline("c1")],
    });
    const snapshot = () =>
      t.run(async (ctx) => ({
        conversations: await ctx.db.query("investigationConversations").collect(),
        operations: await ctx.db.query("investigationOperations").collect(),
        runs: await ctx.db.query("historicalRuns").collect(),
        reveals: await ctx.db.query("historicalReveals").collect(),
        messages: await ctx.db.query("investigationMessages").collect(),
        requests: await ctx.db.query("investigationRequests").collect(),
        scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
      }));
    const before = await snapshot();
    const first = await t.query(list, page(25));
    for (let i = 0; i < 3; i++) expect(await t.query(list, page(25))).toEqual(first);
    const after = await snapshot();
    expect(after).toEqual(before);
    expect(after.scheduled).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(first.page.map((i) => i.status)).toEqual(["running", "completed"]);
  });
});
