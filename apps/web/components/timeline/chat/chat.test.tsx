import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RequestLedger } from "../workspace/requests";
import { ChatPlayground } from "./ChatPlayground";
import { ChatView, ReviewProposal } from "./ChatView";
import { chatHref, displayedReceipt, newerReceipt, readChat, readChats } from "./api";
import { fixtureChat, fixtureReady, fixtureSaved, fixtureChatRun as run } from "./fixtures";
import { type ChatCommand, ChatNavigationGuard, ChatWriteGuard, requestChat } from "./requests";

const key = {
  companyId: run.companyId,
  runId: run.runId,
  conversationId: fixtureChat.conversationId,
};
function setup() {
  let id = 0;
  return {
    ledger: new RequestLedger(() => `request-${++id}`),
    calls: { begin: vi.fn(), send: vi.fn(), reset: vi.fn(), confirm: vi.fn() },
  };
}
describe("saved chat boundary", () => {
  it.each([fixtureChat, fixtureReady, fixtureSaved])(
    "reads collecting, ready and saved receipts",
    (receipt) => {
      expect(readChat(receipt, key, run)).toEqual({ state: "ready", value: receipt });
    },
  );
  it("accepts saved history context and raw invoice, bill and payroll IDs", () => {
    const snapshot = run.baseline.seed.snapshot;
    const ids = [...snapshot.invoices, ...snapshot.bills, ...snapshot.payroll].map(
      (record) => record.id,
    );
    expect(ids.length).toBeGreaterThan(0);
    for (const selectedItemId of ids) {
      expect(
        readChat(
          { ...fixtureChat, selectedItemId, selectedWeek: run.baseline.history[0]!.weekStart },
          key,
          run,
        ).state,
      ).toBe("ready");
    }
    const recordIds = new Set(ids);
    for (const item of run.baseline.seed.scheduledItems.filter((item) =>
      recordIds.has(item.sourceRef),
    ))
      expect(readChat({ ...fixtureChat, selectedItemId: item.id }, key, run).state).toBe("ready");
  });
  it("rejects unknown context and every changed source identity", () => {
    for (const field of [
      "companyId",
      "runId",
      "conversationId",
      "inputHash",
      "constraintVersion",
      "selectedItemId",
      "selectedWeek",
    ])
      expect(readChat({ ...fixtureChat, [field]: "different" }, key, run).state).toBe("unusable");
  });
  it("fails closed on stripped nested fields, invalid dates and unsafe cash", () => {
    const extra = structuredClone(fixtureReady);
    Object.assign(extra.proposal!.changes[0]!, { unexpected: 1 });
    expect(readChat(extra, key, run).state).toBe("unusable");
    for (const change of [
      { kind: "remove_cash", label: "Expense", date: "2026-02-30", amount: 100 },
      { kind: "remove_cash", label: "Expense", date: "2026-11-17", amount: 0.5 },
      { kind: "remove_cash", label: "Expense", date: "2026-11-17", amount: 2 ** 50 },
    ])
      expect(
        readChat(
          { ...fixtureReady, proposal: { ...fixtureReady.proposal, changes: [change] } },
          key,
          run,
        ).state,
      ).toBe("unusable");
  });
  it("rejects inconsistent saved/proposal states and bounded transcripts", () => {
    for (const raw of [
      { ...fixtureChat, proposal: fixtureReady.proposal },
      { ...fixtureReady, linkedRunId: "unexpected" },
      { ...fixtureSaved, linkedRunId: null },
      { ...fixtureChat, turns: Array(43).fill(fixtureChat.turns[0]) },
      { ...fixtureChat, turns: [{ ...fixtureChat.turns[1], text: "x".repeat(1001) }] },
    ])
      expect(readChat(raw, key, run).state).toBe("unusable");
  });
  it("separates missing, loading and failed reads, rejects duplicate history", () => {
    expect(readChat(undefined, key).state).toBe("loading");
    expect(readChat(null, key).state).toBe("missing");
    expect(readChat(new Error(), key).state).toBe("error");
    expect(readChats([fixtureChat, fixtureChat], key, run).state).toBe("unusable");
    expect(readChats([fixtureChat], key, run).state).toBe("ready");
  });
  it("holds a new composer until its durable conversation route is selected", () => {
    // A begin answer arrives before router navigation: do not expose a textbox whose draft
    // would disappear when the conversation URL mounts its keyed view.
    expect(displayedReceipt(fixtureChat, null, true)).toBeNull();
    expect(displayedReceipt(fixtureChat, fixtureChat, true)).toBe(fixtureChat);
    // Once selected, accepted later replies still outrun lagging query subscriptions.
    expect(displayedReceipt(fixtureReady, fixtureChat, true)).toBe(fixtureReady);
    expect(displayedReceipt(fixtureChat, null, false)).toBe(fixtureChat);
  });
  it("never replaces a newer receipt with a delayed reply", () => {
    expect(newerReceipt(fixtureSaved, fixtureReady)).toBe(fixtureSaved);
    expect(newerReceipt(fixtureChat, fixtureReady)).toBe(fixtureReady);
  });
});
describe("confirmed chat writes", () => {
  it("sends only the server conversation identity/revision when confirming", async () => {
    const { ledger, calls } = setup();
    calls.confirm.mockResolvedValue(fixtureSaved);
    expect(
      await requestChat(run, { kind: "confirm", receipt: fixtureReady }, ledger, calls),
    ).toEqual({ ok: true, receipt: fixtureSaved });
    expect(calls.confirm).toHaveBeenCalledWith({
      companyId: run.companyId,
      conversationId: fixtureReady.conversationId,
      expectedRevision: 3,
      requestId: "request-1",
      reviewed: true,
    });
    expect(calls.send).not.toHaveBeenCalled();
  });
  it("retains the exact request key after an uncertain answer", async () => {
    const { ledger, calls } = setup();
    const command = { kind: "send" as const, receipt: fixtureChat, text: "$50,000" };
    calls.send
      .mockRejectedValueOnce(new Error("Lost network answer"))
      .mockResolvedValueOnce({ ...fixtureChat, revision: 2 });
    expect(await requestChat(run, command, ledger, calls)).toMatchObject({
      ok: false,
      uncertain: true,
    });
    expect(await requestChat(run, command, ledger, calls)).toMatchObject({ ok: true });
    expect(calls.send.mock.calls.map(([args]) => args.requestId)).toEqual([
      "request-1",
      "request-1",
    ]);
  });
  it("freezes an unconfirmed payload while a subscription advances", () => {
    const guard = new ChatWriteGuard();
    const original: ChatCommand = { kind: "send", receipt: fixtureChat, text: "$50,000" };
    guard.remember(original);
    expect(guard.allows({ ...original, receipt: { ...fixtureChat, revision: 2 } })).toBe(false);
    expect(guard.allows({ kind: "confirm", receipt: fixtureReady })).toBe(false);
    expect(guard.allows(original)).toBe(true);
    guard.resolve();
    expect(guard.allows({ kind: "reset", receipt: fixtureReady })).toBe(true);
  });
  it("requires the returned proposal to equal the reviewed proposal", async () => {
    const { ledger, calls } = setup();
    calls.confirm.mockResolvedValue({
      ...fixtureSaved,
      proposal: { ...fixtureSaved.proposal, label: "Different" },
    });
    expect(
      await requestChat(run, { kind: "confirm", receipt: fixtureReady }, ledger, calls),
    ).toMatchObject({ ok: false, uncertain: true });
  });
  it("rejects saved, wrong-source and not-ready confirmations before any write", async () => {
    const { ledger, calls } = setup();
    for (const receipt of [
      fixtureSaved,
      fixtureChat,
      { ...fixtureReady, inputHash: "c".repeat(64) },
    ])
      expect(await requestChat(run, { kind: "confirm", receipt }, ledger, calls)).toMatchObject({
        ok: false,
      });
    expect(calls.confirm).not.toHaveBeenCalled();
  });
  it("rejects mismatched revisions and selected context on accepted responses", async () => {
    const { ledger, calls } = setup();
    calls.send.mockResolvedValue({ ...fixtureChat, revision: 5 });
    expect(
      await requestChat(
        run,
        { kind: "send", receipt: fixtureChat, text: "$50,000" },
        ledger,
        calls,
      ),
    ).toMatchObject({ ok: false, uncertain: true });
    calls.send.mockResolvedValue({
      ...fixtureChat,
      revision: 2,
      selectedWeek: run.forecast.weeks[0]!.weekStart,
    });
    expect(
      await requestChat(
        run,
        { kind: "send", receipt: fixtureChat, text: "$50,000" },
        ledger,
        calls,
      ),
    ).toMatchObject({ ok: false, uncertain: true });
  });
  it("guards navigation against late begin replies and unmounted screens", () => {
    const guard = new ChatNavigationGuard();
    guard.setContext("source-a");
    const old = guard.capture();
    guard.setContext("source-b");
    expect(guard.allows(old)).toBe(false);
    guard.setContext("source-a");
    expect(guard.allows(old)).toBe(false);
    guard.dispose();
    expect(guard.allows("source-b")).toBe(false);
  });
});
describe("chat review rendering", () => {
  it("keeps timeline controls and chat together without duplicating the source chart", () => {
    const markup = renderToStaticMarkup(createElement(ChatPlayground));
    expect(markup).toContain('data-testid="workspace"');
    expect(markup).toContain('data-testid="timeline-chat-sidebar"');
    expect(markup).toContain('id="timeline-chat"');
    expect(markup).toContain("Expense amount");
    expect(markup).not.toContain("View source timeline and rules");
    expect(markup).toContain('aria-label="Scenarios"');
  });
  it("builds in-page conversation links preserving source and pinned selection", () => {
    const href = chatHref("a/b", "run?x", "chat#x", "2026-11-02", "invoice/a");
    const url = new URL(href, "http://localhost");
    expect(url.pathname).toBe("/c/a%2Fb/timeline");
    expect(url.hash).toBe("#timeline-chat");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      runId: "run?x",
      conversationId: "chat#x",
      selectedWeek: "2026-11-02",
      selectedItemId: "invoice/a",
    });
  });

  it("offers the composer before any message and shows an answer's sources", () => {
    const empty = renderToStaticMarkup(
      createElement(ChatView, {
        run,
        selected: null,
        history: { state: "ready", value: [] },
        actions: { write: vi.fn(), beginNavigates: true },
      }),
    );
    expect(empty).toContain("Ask Domino");
    expect(empty).toContain("Ask or describe a what-if");
    expect(empty).not.toContain(">Start new chat</button>");
    const answered = {
      ...fixtureChat,
      turns: [
        ...fixtureChat.turns.slice(0, -1),
        {
          ...fixtureChat.turns.at(-1)!,
          citations: [{ ref: "forecast:low", label: "Lowest forecast week" }],
        },
      ],
    };
    const shown = renderToStaticMarkup(
      createElement(ChatView, {
        run,
        selected: { state: "ready", value: answered },
        history: { state: "ready", value: [answered] },
        actions: { write: vi.fn() },
      }),
    );
    expect(shown).toContain("Where this comes from (1)");
    expect(shown).toContain("forecast:low");
  });

  function html(receipt: typeof fixtureChat | null) {
    return renderToStaticMarkup(
      createElement(ChatView, {
        run,
        selected: receipt ? { state: "ready", value: receipt } : null,
        history: { state: "ready", value: [fixtureChat] },
        actions: { write: vi.fn() },
      }),
    );
  }
  it("never starts a conversation from a render", () => {
    const write = vi.fn();
    const markup = renderToStaticMarkup(
      createElement(ChatView, {
        run,
        selected: null,
        history: { state: "ready", value: [fixtureChat] },
        actions: { write },
      }),
    );
    expect(markup).toContain("Ask or describe a what-if");
    expect(markup).not.toContain("Calculate and save scenario");
    expect(write).not.toHaveBeenCalled();
  });
  it("shows the pending field and safe short reply hint", () => {
    const markup = html(fixtureChat);
    expect(markup).toContain("Expense amount");
    expect(markup).toContain("Short answers are welcome");
    expect(markup).toContain("Ask Domino");
    expect(markup).not.toContain("revision 1");
  });
  it("renders exact amounts/date and the full rule set before disabled confirmation", () => {
    const markup = html(fixtureReady);
    expect(markup).toContain("$50,000");
    expect(markup).toContain("2026-11-09");
    expect(markup).toContain("Rules for the new timeline");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Calculate and save scenario/);
  });
  it("shows every retained source rule for a cash-only proposal", () => {
    const receipt = { ...fixtureReady, proposal: { ...fixtureReady.proposal!, constraints: null } };
    const rules = fixtureReady.proposal!.constraints!;
    const markup = renderToStaticMarkup(
      createElement(ReviewProposal, { receipt, sourceRules: rules }),
    );
    expect(markup).toContain("All source rules stay in place");
    for (const rule of rules) expect(markup).toContain(rule.label.replaceAll("'", "&#x27;"));
    expect(markup).toContain("$3,150,000");
  });
  it("links saved result and removes the composer", () => {
    const markup = html(fixtureSaved);
    expect(markup).toContain("Open saved timeline");
    expect(markup).not.toContain("Send reply");
    expect(chatHref("a/b", "source?x", "chat#x")).toContain(
      "/c/a%2Fb/timeline?runId=source%3Fx&amp;".replace("&amp;", "&"),
    );
  });
});
