import { describe, expect, it } from "vitest";
import {
  hasEntryReveal,
  openedTimelineHref,
  withoutEntryReveal,
  workerTimelineHref,
} from "./timeline-entry";

describe("explicit saved scenario entry links", () => {
  it("pins Worker reveal to the exact fix run while preserving the conversation", () => {
    const href = workerTimelineHref("company/one", "run/one", "chat/one");
    const url = new URL(href, "http://localhost");
    expect(url.pathname).toBe("/c/company%2Fone/timeline");
    expect(url.searchParams.get("conversationId")).toBe("chat/one");
    expect(url.hash).toBe("#timeline-chat");
    expect(hasEntryReveal(url.search, "run/one")).toBe(true);
    expect(hasEntryReveal(url.search, "other")).toBe(false);
  });
  it("rejects absent, mismatched or duplicated entry intents", () => {
    for (const search of [
      "runId=child",
      "runId=child&reveal=parent",
      "runId=other&reveal=child",
      "runId=child&reveal=child&reveal=child",
      "runId=child&runId=other&reveal=child",
    ])
      expect(hasEntryReveal(search, "child")).toBe(false);
  });
  it("consumes only reveal, keeping chat, pinned week/item and hash; repeats have no intent", () => {
    const href = `${openedTimelineHref("kestrel", "child")}&conversationId=chat&selectedWeek=2026-11-02&selectedItemId=bill#timeline-chat`;
    const consumed = withoutEntryReveal(href, "child");
    expect(consumed).toBe(
      "/c/kestrel/timeline?runId=child&conversationId=chat&selectedWeek=2026-11-02&selectedItemId=bill#timeline-chat",
    );
    expect(hasEntryReveal(new URL(consumed, "http://localhost").search, "child")).toBe(false);
    expect(withoutEntryReveal(consumed, "child")).toBe(consumed);
    expect(withoutEntryReveal(href, "parent")).toBe(href);
  });
});
