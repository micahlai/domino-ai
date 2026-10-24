import { describe, expect, it } from "vitest";
import { type Conversation, DOMINO_ID, adaptConversation } from "./adapt";

type Op = Conversation["operations"][number];

const profile = {
  role: "Evidence analyst",
  workingStyle: "Cites every claim",
  instructions: "Use only the supplied filings.",
  version: "evidence_analyst@0123456789ab",
  tools: [],
  knowledgeCutoff: "2023-11-08",
};
const op = (o: Partial<Op> & Pick<Op, "operationId" | "kind" | "status">): Op => ({
  sequence: Number(o.operationId.slice(2)),
  title: o.operationId,
  dependsOn: [],
  createdAt: "2026-10-24T18:00:00.000Z",
  ...o,
});
const source = op({
  operationId: "op1",
  kind: "source_load",
  status: "succeeded",
  output: {
    origin: "curated_archive",
    sources: [
      { id: "s1", title: "10-Q", url: "https://example.com/q", publishedAt: "2023-11-08" },
      { id: "s2", title: "Bad link", url: "javascript:alert(1)" },
    ],
  },
});
const forecast = op({
  operationId: "op2",
  kind: "forecast",
  status: "succeeded",
  dependsOn: ["op1"],
  outputRef: { kind: "run", id: "baseline-1" },
});
const analyst = (o: Partial<Op> = {}) =>
  op({
    operationId: "op3",
    kind: "specialist",
    role: "evidence_analyst",
    status: "queued",
    dependsOn: ["op1", "op2"],
    profile,
    ...o,
  });
const conv = (operations: Op[], messages: Conversation["messages"] = []): Conversation => ({
  conversationId: "conv-1",
  messages,
  operations,
  busy: false,
  canReveal: false,
  canAlternative: false,
});
const node = (c: Conversation, id: string) => adaptConversation(c).nodes.find((n) => n.id === id);

describe("adaptConversation", () => {
  it("keeps queued and running distinct, and never invents progress", () => {
    const out = adaptConversation(
      conv([op({ operationId: "op1", kind: "source_load", status: "running" }), analyst()]),
    );
    expect(out.nodes.map((n) => [n.id, n.status])).toEqual([
      [DOMINO_ID, "running"],
      ["op1", "running"],
      ["op3", "queued"],
    ]);
    expect(out.nodes.some((n) => n.kind === "output")).toBe(false);
  });

  it("shows unknown as failed in words, never as success", () => {
    const n = node(
      conv([
        analyst({
          status: "unknown",
          error: { code: "outcome_unknown", message: "No result arrived." },
        }),
      ]),
      "op3",
    );
    expect(n?.status).toBe("failed");
    expect(n?.error).toMatch(/outcome is unknown/i);
  });

  it("describes only the archived origin it was told about", () => {
    expect(node(conv([source]), "op1")?.summary).toMatch(/Not live retrieval/);
    const other = op({ ...source, output: { ...(source.output as object), origin: "web" } });
    expect(node(conv([other]), "op1")?.summary).not.toMatch(/archived/i);
  });

  it("maps sources to evidence; unsafe links are kept as data for the view to refuse", () => {
    expect(node(conv([source]), "op1")?.evidence?.map((e) => e.id)).toEqual(["s1", "s2"]);
  });

  it("leaves an unreported model unknown", () => {
    const n = node(
      conv([
        analyst({
          status: "failed",
          error: {
            code: "provider_unavailable",
            message: "Not connected. No model call was made.",
          },
        }),
      ]),
      "op3",
    );
    expect(n?.profile?.model).toBeUndefined();
    expect(n?.profile?.provider).toBeUndefined();
    expect(n?.metadata).toContainEqual({ label: "Model", value: "unknown" });
    expect(n?.error).toBe("Not connected. No model call was made.");
  });

  it("keeps the forecast output when the provider fails", () => {
    const out = adaptConversation(
      conv([
        source,
        forecast,
        analyst({ status: "failed", error: { code: "provider_unavailable", message: "x" } }),
      ]),
    );
    expect(out.nodes.find((n) => n.id === "op2")?.status).toBe("succeeded");
    expect(out.outputs.get("op2:output")).toEqual({
      stage: "forecast",
      baselineRunId: "baseline-1",
      revealed: false,
    });
    expect(out.nodes.find((n) => n.id === "op3")?.status).toBe("failed");
    expect(out.nodes.find((n) => n.id === DOMINO_ID)?.status).toBe("failed");
  });

  it("makes no reveal or alternative output before those steps succeeded", () => {
    const out = adaptConversation(
      conv([
        source,
        forecast,
        op({ operationId: "op4", kind: "reveal", status: "running", dependsOn: ["op2"] }),
        op({ operationId: "op5", kind: "alternative", status: "queued", dependsOn: ["op2"] }),
      ]),
    );
    expect([...out.outputs.keys()]).toEqual(["op2:output"]);
  });

  it("points reveal and alternative outputs at their saved runs", () => {
    const out = adaptConversation(
      conv([
        source,
        forecast,
        op({
          operationId: "op4",
          kind: "reveal",
          status: "succeeded",
          dependsOn: ["op2"],
          outputRef: { kind: "reveal", id: "baseline-1" },
        }),
        op({
          operationId: "op5",
          kind: "alternative",
          status: "succeeded",
          dependsOn: ["op2"],
          outputRef: { kind: "run", id: "alt-1" },
        }),
      ]),
    );
    expect(out.outputs.get("op4:output")).toMatchObject({ stage: "reveal", revealed: true });
    expect(out.outputs.get("op5:output")).toMatchObject({
      stage: "alternative",
      altRunId: "alt-1",
      revealed: true,
    });
  });

  it("refuses a reveal that names another run", () => {
    const out = adaptConversation(
      conv([
        source,
        forecast,
        op({
          operationId: "op4",
          kind: "reveal",
          status: "succeeded",
          dependsOn: ["op2"],
          outputRef: { kind: "reveal", id: "other-run" },
        }),
      ]),
    );
    expect(out.outputs.has("op4:output")).toBe(false);
    expect(out.nodes.find((n) => n.id === "op4:output")?.status).toBe("failed");
  });

  it("marks a succeeded specialist with unreadable output as failed", () => {
    const n = node(conv([analyst({ status: "succeeded", output: { assessment: "x" } })]), "op3");
    expect(n?.status).toBe("failed");
    expect(n?.outputText).toBeUndefined();
  });

  it("shows a valid assessment and its uncertainties", () => {
    const n = node(
      conv([
        analyst({
          status: "succeeded",
          output: {
            assessment: "Cash was lower than the filing implied.",
            citations: [{ kind: "source", id: "s1" }],
            uncertainties: ["The next report may differ."],
          },
        }),
      ]),
      "op3",
    );
    expect(n?.status).toBe("succeeded");
    expect(n?.outputText).toContain("Cash was lower");
    expect(n?.outputText).toContain("The next report may differ.");
    expect(n?.profile?.version).toBe(profile.version);
  });

  it("builds edges from recorded dependencies only, roots hang off Domino", () => {
    const out = adaptConversation(conv([source, forecast, analyst()]));
    expect(out.edges.map((e) => `${e.source}>${e.target}`)).toEqual([
      "domino>op1",
      "op1>op2",
      "op2>op2:output",
      "op1>op3",
      "op2>op3",
    ]);
  });

  it("does not turn message prose into steps", () => {
    const out = adaptConversation(
      conv(
        [],
        [
          {
            id: "m2",
            sequence: 2,
            role: "assistant",
            kind: "assessment",
            text: "I ran the forecast tool and called the reviewer agent.",
          },
          { id: "m1", sequence: 1, role: "user", kind: "question", text: "Why?" },
        ],
      ),
    );
    expect(out.nodes.map((n) => n.id)).toEqual([DOMINO_ID]);
    expect(out.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("states the fixed workflow on the Domino node", () => {
    expect(node(conv([source]), DOMINO_ID)?.summary).toMatch(/fixed set of steps/);
  });
});
