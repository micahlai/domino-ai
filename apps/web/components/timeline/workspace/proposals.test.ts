import { describe, expect, it, vi } from "vitest";
import type { QuestionReceipt, ReviseArgs, SimulateArgs } from "./api";
import { fixtureQuestions, fixtureRule } from "./fixtures";
import { confirmQuestionProposal } from "./proposals";
import { RequestLedger } from "./requests";

function question(): QuestionReceipt {
  const q = structuredClone(fixtureQuestions[1]!);
  if (!q.proposal) throw new Error("Missing proposal fixture");
  return q;
}

function setup() {
  let n = 0;
  return {
    ledger: new RequestLedger(() => `request-${++n}`),
    writes: {
      revise: vi.fn(async (_args: ReviseArgs) => ({ ok: true as const, runId: "saved-rules" })),
      simulate: vi.fn(async (_args: SimulateArgs) => ({
        ok: true as const,
        runId: "saved-scenario",
      })),
      relink: vi.fn(async (_questionId: string, runId: string) => ({ ok: true as const, runId })),
    },
  };
}

describe("confirmed question proposals", () => {
  it("saves a rule-only proposal as a revision and links that exact result", async () => {
    const q = question();
    q.proposal!.changes = [];
    q.proposal!.constraints = [fixtureRule];
    q.proposal!.constraintNote = "Keep the agreed cash floor.";
    const { ledger, writes } = setup();
    const context = { companyId: q.companyId, runId: q.runId };

    expect(await confirmQuestionProposal(q, context, ledger, writes)).toEqual({
      ok: true,
      runId: "saved-rules",
    });
    expect(writes.simulate).not.toHaveBeenCalled();
    expect(writes.revise).toHaveBeenCalledWith({
      companyId: q.companyId,
      parentRunId: q.runId,
      requestId: "request-1",
      constraintsJson: JSON.stringify([fixtureRule]),
      note: q.proposal!.constraintNote,
      reviewed: true,
    });
    expect(writes.relink).toHaveBeenCalledWith(q.id, "saved-rules");
  });

  it("keeps a confirmed event and its rules together in one simulation", async () => {
    const q = question();
    q.proposal!.constraints = [fixtureRule];
    q.proposal!.constraintNote = "Check the same cash floor.";
    const { ledger, writes } = setup();
    await confirmQuestionProposal(q, q, ledger, writes);
    expect(writes.revise).not.toHaveBeenCalled();
    expect(writes.simulate).toHaveBeenCalledWith({
      companyId: q.companyId,
      parentRunId: q.runId,
      requestId: "request-1",
      label: q.proposal!.label,
      changesJson: JSON.stringify(q.proposal!.changes),
      constraintsJson: JSON.stringify([fixtureRule]),
      constraintNote: q.proposal!.constraintNote,
      reviewed: true,
    });
    expect(writes.relink).toHaveBeenCalledWith(q.id, "saved-scenario");
  });

  it("preserves event-only proposals without adding rules", async () => {
    const q = question();
    const { ledger, writes } = setup();
    await confirmQuestionProposal(q, q, ledger, writes);
    const args = writes.simulate.mock.calls[0]![0];
    expect(args).not.toHaveProperty("constraintsJson");
    expect(args).not.toHaveProperty("constraintNote");
    expect(writes.revise).not.toHaveBeenCalled();
  });

  it("supports an explicitly reviewed removal of all rules", async () => {
    const q = question();
    q.proposal = {
      label: "Remove rules",
      changes: [],
      constraints: [],
      constraintNote: "Remove all",
    };
    const { ledger, writes } = setup();
    await confirmQuestionProposal(q, q, ledger, writes);
    expect(writes.revise).toHaveBeenCalledWith(expect.objectContaining({ constraintsJson: "[]" }));
    expect(writes.simulate).not.toHaveBeenCalled();
  });

  it.each(["missing", "empty", "note", "company", "run", "unknown", "unsafe"])(
    "refuses an unusable proposal (%s) before any write",
    async (bad) => {
      const q = question();
      const context = { companyId: q.companyId, runId: q.runId };
      if (bad === "missing") q.proposal = null;
      if (bad === "empty") q.proposal!.changes = [];
      if (bad === "note") q.proposal!.constraints = [fixtureRule];
      if (bad === "company") context.companyId = "other";
      if (bad === "run") context.runId = "other";
      if (bad === "unknown") Object.assign(q.proposal!, { calculation: 123 });
      if (bad === "unsafe")
        q.proposal!.changes = [
          { kind: "add_cash", label: "Cash", date: "2026-11-18", amount: 0.5 },
        ];
      const { ledger, writes } = setup();
      expect(await confirmQuestionProposal(q, context, ledger, writes)).toMatchObject({
        ok: false,
      });
      expect(writes.revise).not.toHaveBeenCalled();
      expect(writes.simulate).not.toHaveBeenCalled();
      expect(writes.relink).not.toHaveBeenCalled();
    },
  );

  it.each(["rules", "event"])(
    "reuses the exact %s write request after an uncertain answer",
    async (kind) => {
      const q = question();
      if (kind === "rules")
        q.proposal = {
          label: "Cash floor",
          changes: [],
          constraints: [fixtureRule],
          constraintNote: "Keep cash",
        };
      const { ledger, writes } = setup();
      const write = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, message: "The saved result is uncertain." })
        .mockResolvedValueOnce({ ok: true, runId: "saved-on-first-attempt" });
      const adapters = { ...writes, [kind === "rules" ? "revise" : "simulate"]: write };
      expect(await confirmQuestionProposal(q, q, ledger, adapters)).toMatchObject({ ok: false });
      expect(writes.relink).not.toHaveBeenCalled();
      expect(await confirmQuestionProposal(q, q, ledger, adapters)).toMatchObject({ ok: true });
      expect(write.mock.calls[0]![0]).toEqual(write.mock.calls[1]![0]);
      expect(writes.relink).toHaveBeenCalledWith(q.id, "saved-on-first-attempt");
    },
  );

  it("retains the saved run when linking fails so only the link needs recovery", async () => {
    const q = question();
    const { ledger, writes } = setup();
    const relink = vi.fn(async () => ({ ok: false as const, message: "Link uncertain" }));
    expect(await confirmQuestionProposal(q, q, ledger, { ...writes, relink })).toEqual({
      ok: true,
      runId: "saved-scenario",
      linkError: "Link uncertain",
    });
    expect(writes.simulate).toHaveBeenCalledTimes(1);
    expect(relink).toHaveBeenCalledWith(q.id, "saved-scenario");
  });
});
