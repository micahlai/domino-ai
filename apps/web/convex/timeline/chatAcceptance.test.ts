/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { WeeklySeedV1Schema } from "@domino/contracts";
import { weeklyBoundaryFixtures } from "@domino/contracts/fixtures";
import { engine } from "@domino/engine";
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { readChat, readChats } from "../../components/timeline/chat/api";
import { readRun } from "../../components/timeline/workspace/api";
import schema from "../schema";
import { chatRefs } from "./chat/refs";
import { baselineRefs } from "./refs";
import { workspaceRefs } from "./workspaceRefs";

const modules = Object.fromEntries(
  Object.entries(
    import.meta.glob([
      "../**/*.ts",
      "../_generated/*.js",
      "!../**/*.test.ts",
      "!./*.test.ts",
      "!./*.test-support.ts",
    ]),
  ).map(([path, load]) => [path.replace(/^\.\//, "../timeline/"), load]),
);
afterEach(() => vi.restoreAllMocks());

it("TL9 real clarification receipts fit the screen, save the exact draft and quietly reopen", async () => {
  const t = convexTest(schema, modules);
  const seed = WeeklySeedV1Schema.parse(weeklyBoundaryFixtures.validKestrelWeeklySeed);
  const baseline = await t.mutation(baselineRefs.save, {
    requestId: "tl9-acceptance-baseline",
    seedJson: JSON.stringify(seed),
    modelJson: JSON.stringify({ version: 0, customerDelayDays: {}, recurringSpend: [], rules: [] }),
    constraintsJson: "[]",
    assumptionNote: "Labelled synthetic Kestrel fixture with reviewed neutral assumptions",
    reviewed: true,
  });
  const opened = await t.mutation(workspaceRefs.open, {
    companyId: seed.company.id,
    baselineRunId: baseline.runId,
    requestId: "tl9-acceptance-open",
  });
  const key = { companyId: seed.company.id, runId: opened.runId };
  const source = await t.query(workspaceRefs.get, key);
  const screen = readRun(source, key);
  if (screen.state !== "ready") throw new Error("Source does not fit screen");
  const calls = [vi.spyOn(engine, "forecast"), vi.spyOn(globalThis, "fetch")];
  const begun = await t.mutation(chatRefs.begin, { ...key, requestId: "tl9-acceptance-begin" });
  let receipt = begun;
  for (const [index, text] of [
    "What if we spend $80,000?",
    "on 2026-11-17",
    "Atlas Legal",
  ].entries()) {
    receipt = await t.mutation(chatRefs.send, {
      companyId: key.companyId,
      conversationId: receipt.conversationId,
      requestId: `tl9-acceptance-send-${index}`,
      expectedRevision: receipt.revision,
      text,
    });
    expect(
      readChat(receipt, { ...key, conversationId: receipt.conversationId }, screen.value).state,
    ).toBe("ready");
    if (index < 2) expect(receipt.proposal).toBeNull();
  }
  for (const spy of calls) expect(spy).not.toHaveBeenCalled();
  expect(receipt.status).toBe("ready");
  expect(receipt.proposal?.changes).toEqual([
    { kind: "remove_cash", date: "2026-11-17", amount: 8_000_000, label: "Payment to Atlas Legal" },
  ]);
  const confirmed = await t.mutation(chatRefs.confirm, {
    companyId: key.companyId,
    conversationId: receipt.conversationId,
    requestId: "tl9-acceptance-confirm",
    expectedRevision: receipt.revision,
    reviewed: true,
  });
  expect(readChat(confirmed, key, screen.value).state).toBe("ready");
  expect(confirmed.status).toBe("saved");
  if (!confirmed.linkedRunId) throw new Error("No saved scenario");
  const result = await t.query(workspaceRefs.get, { ...key, runId: confirmed.linkedRunId });
  expect(result?.parentRunId).toBe(key.runId);
  expect(result?.changes).toEqual(receipt.proposal?.changes);
  for (const spy of calls) spy.mockClear();
  expect(
    await t.query(chatRefs.get, {
      companyId: key.companyId,
      conversationId: receipt.conversationId,
    }),
  ).toEqual(confirmed);
  const listed = await t.query(chatRefs.list, key);
  expect(readChats(listed, key, screen.value).state).toBe("ready");
  expect(await t.mutation(chatRefs.begin, { ...key, requestId: "tl9-acceptance-begin" })).toEqual(
    begun,
  );
  expect(await t.query(workspaceRefs.get, key)).toEqual(source);
  for (const spy of calls) expect(spy).not.toHaveBeenCalled();
});
