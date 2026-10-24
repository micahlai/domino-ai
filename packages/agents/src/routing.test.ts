import type { AgentBackend, AgentJob } from "@domino/contracts";
import { fixtures } from "@domino/contracts/fixtures";
import { describe, expect, it, vi } from "vitest";
import { AgentJobError, backendFor, createAgentRouter } from "./index";

const mapping = {
  source: "stripe",
  entity: "invoices",
  fields: { amount: "amount_due" },
  transforms: ["dollars to cents"],
  endpoint: "/sample/invoices",
};
const branch = fixtures.branches[1]!;
const snapshot = fixtures.snapshot;
const briefInput = { grade: { errorPct: 0, misses: [] }, model: fixtures.model };

function clients(creaoOutput: unknown, claudeOutput: unknown = creaoOutput) {
  return {
    creao: { run: vi.fn(async (_job: AgentJob, _input: unknown): Promise<unknown> => creaoOutput) },
    claude: {
      run: vi.fn(async (_job: AgentJob, _input: unknown): Promise<unknown> => claudeOutput),
    },
  };
}

describe("backendFor", () => {
  const defaults: [AgentJob, AgentBackend][] = [
    ["mapSource", "creao"],
    ["readConstraints", "creao"],
    ["proposeFixes", "claude"],
    ["explain", "claude"],
    ["weeklyBrief", "creao"],
  ];

  it.each(defaults)("defaults %s to %s", (job, backend) => {
    expect(backendFor(job, {})).toBe(backend);
    expect(backendFor(job, { [`AGENT_BACKEND_${job.toUpperCase()}`]: "  " })).toBe(backend);
  });

  it.each(defaults)("overrides %s", (job, backend) => {
    const other = backend === "creao" ? "claude" : "creao";
    expect(backendFor(job, { [`AGENT_BACKEND_${job.toUpperCase()}`]: other })).toBe(other);
  });

  it("rejects unknown values without echoing them", () => {
    expect(() => backendFor("mapSource", { AGENT_BACKEND_MAPSOURCE: "secret-value" })).toThrow(
      "AGENT_BACKEND_MAPSOURCE must be creao or claude",
    );
  });
});

describe("validated agent jobs", () => {
  it("passes each facade input to the expected backend and returns validated values", async () => {
    const providers = clients([mapping], [fixtures.fixes[0]]);
    const { agents } = createAgentRouter(providers);
    expect(await agents.mapSource("API docs", [{ amount_due: 1 }])).toEqual([mapping]);
    expect(providers.creao.run).toHaveBeenCalledWith("mapSource", {
      apiDocs: "API docs",
      samples: [{ amount_due: 1 }],
    });

    providers.creao.run.mockResolvedValueOnce(fixtures.constraints);
    expect(await agents.readConstraints([{ name: "loan", text: "minimum" }])).toEqual(
      fixtures.constraints,
    );
    expect(providers.creao.run).toHaveBeenCalledWith("readConstraints", [
      { name: "loan", text: "minimum" },
    ]);

    expect(await agents.proposeFixes(branch, snapshot)).toEqual([fixtures.fixes[0]]);
    expect(providers.claude.run).toHaveBeenCalledWith("proposeFixes", { branch, snapshot });

    providers.claude.run.mockResolvedValueOnce("One. Two. Three.");
    expect(await agents.explain(branch)).toBe("One. Two. Three.");
    expect(providers.claude.run).toHaveBeenCalledWith("explain", branch);

    providers.creao.run.mockResolvedValueOnce("  Weekly update.  ");
    expect(await agents.weeklyBrief(briefInput)).toBe("Weekly update.");
    expect(providers.creao.run).toHaveBeenCalledWith("weeklyBrief", briefInput);
  });

  it("accepts JSON text for structured jobs and reports the responding backend", async () => {
    const providers = clients(JSON.stringify([mapping]));
    const { runJob } = createAgentRouter(providers);
    await expect(runJob("mapSource", { apiDocs: "docs", samples: [] })).resolves.toEqual({
      value: [mapping],
      backend: "creao",
    });
  });

  it("uses the configured override for every job", async () => {
    const providers = clients([], []);
    const env = {
      AGENT_BACKEND_MAPSOURCE: "claude",
      AGENT_BACKEND_READCONSTRAINTS: "claude",
      AGENT_BACKEND_PROPOSEFIXES: "creao",
      AGENT_BACKEND_EXPLAIN: "creao",
      AGENT_BACKEND_WEEKLYBRIEF: "claude",
    };
    const { agents } = createAgentRouter(providers, env);
    await agents.mapSource("docs", []);
    await agents.readConstraints([]);
    await agents.proposeFixes(branch, snapshot);
    // The two text jobs need text outputs, so override the next mocked responses.
    providers.creao.run.mockResolvedValueOnce("One.");
    await agents.explain(branch);
    providers.claude.run.mockResolvedValueOnce("Brief.");
    await agents.weeklyBrief(briefInput);
    expect(providers.claude.run.mock.calls.map(([job]) => job)).toEqual([
      "mapSource",
      "readConstraints",
      "weeklyBrief",
    ]);
    expect(providers.creao.run.mock.calls.map(([job]) => job)).toEqual(["proposeFixes", "explain"]);
  });

  it("retries invalid JSON, schema failure and transport failure before Claude fallback", async () => {
    const providers = clients("bad json", [mapping]);
    providers.creao.run.mockRejectedValueOnce(new Error("private transport detail"));
    const { runJob } = createAgentRouter(providers);
    await expect(runJob("mapSource", { apiDocs: "docs", samples: [] })).resolves.toEqual({
      value: [mapping],
      backend: "claude",
    });
    expect(providers.creao.run).toHaveBeenCalledTimes(2);
    expect(providers.claude.run).toHaveBeenCalledTimes(1);
  });

  it("retries invalid schema output on the same backend once", async () => {
    const providers = clients([mapping]);
    providers.creao.run.mockResolvedValueOnce([{ source: "invalid" }]);
    const { agents } = createAgentRouter(providers);
    await expect(agents.mapSource("docs", [])).resolves.toEqual([mapping]);
    expect(providers.creao.run).toHaveBeenCalledTimes(2);
    expect(providers.claude.run).not.toHaveBeenCalled();
  });

  it("rejects invalid constraint and fix arrays rather than returning them", async () => {
    const constraintProviders = clients([{ kind: "min_cash" }]);
    await expect(
      createAgentRouter(constraintProviders).agents.readConstraints([]),
    ).rejects.toBeInstanceOf(AgentJobError);
    const fixProviders = clients([], [{ changes: [] }]);
    await expect(
      createAgentRouter(fixProviders).agents.proposeFixes(branch, snapshot),
    ).rejects.toBeInstanceOf(AgentJobError);
  });

  it("rejects empty text and a fourth sentence, but accepts three and decimal amounts", async () => {
    const providers = clients("  ", "  ");
    await expect(
      createAgentRouter(providers).agents.weeklyBrief(briefInput),
    ).rejects.toBeInstanceOf(AgentJobError);
    providers.claude.run.mockResolvedValue("One. Two? Three! Four.");
    await expect(createAgentRouter(providers).agents.explain(branch)).rejects.toBeInstanceOf(
      AgentJobError,
    );
    providers.claude.run.mockResolvedValue("Cash is $3.2M. It changes next week. Review it.");
    await expect(createAgentRouter(providers).agents.explain(branch)).resolves.toBe(
      "Cash is $3.2M. It changes next week. Review it.",
    );
  });

  it("caps failure at two CREAO plus two Claude attempts and hides provider secrets", async () => {
    const providers = clients(null);
    providers.creao.run.mockRejectedValue(new Error("secret-creao-token"));
    providers.claude.run.mockRejectedValue(new Error("secret-claude-token"));
    const { agents } = createAgentRouter(providers);
    const error = await agents.mapSource("private docs", []).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(AgentJobError);
    expect(error).toMatchObject({
      job: "mapSource",
      attemptedBackends: ["creao", "creao", "claude", "claude"],
    });
    expect(String(error)).not.toMatch(/secret|private/);
    expect(providers.creao.run).toHaveBeenCalledTimes(2);
    expect(providers.claude.run).toHaveBeenCalledTimes(2);
  });

  it("never falls back from a Claude primary into Claude again", async () => {
    const providers = clients("", "");
    const { agents } = createAgentRouter(providers);
    const error = await agents.explain(branch).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ attemptedBackends: ["claude", "claude"] });
    expect(providers.creao.run).not.toHaveBeenCalled();
    expect(providers.claude.run).toHaveBeenCalledTimes(2);
  });
});
