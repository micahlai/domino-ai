import { describe, expect, it } from "vitest";
import { fixtureChat } from "./fixtures";
import { bindMessage, messageAcknowledged, queuedMessage, visibleMessage } from "./optimistic";

describe("optimistic chat messages", () => {
  it("shows the first message during both begin and send before a receipt arrives", () => {
    const first = queuedMessage("first-local", "What if we add an expense?", null);
    expect(visibleMessage(first, null)?.text).toBe("What if we add an expense?");
    const begun = bindMessage(first, { ...fixtureChat, turns: [fixtureChat.turns[0]!] });
    expect(begun.conversationId).toBe(fixtureChat.conversationId);
    expect(visibleMessage(begun, { ...fixtureChat, turns: [fixtureChat.turns[0]!] })).toBe(begun);
  });
  it("does not lose an in-flight message when a stale subscription refreshes", () => {
    const message = queuedMessage("reply", "$50,000", fixtureChat);
    expect(visibleMessage(message, fixtureChat)).toBe(message);
    expect(visibleMessage(message, { ...fixtureChat, revision: 2 })).toBe(message);
  });
  it("deduplicates against an acknowledged server turn without matching old identical messages", () => {
    const text = fixtureChat.turns.find((turn) => turn.role === "user")!.text;
    const message = queuedMessage("reply", text, fixtureChat);
    expect(messageAcknowledged(message, fixtureChat)).toBe(false);
    const answered = {
      ...fixtureChat,
      revision: 2,
      turns: [
        ...fixtureChat.turns,
        { id: "new", role: "user" as const, text, createdAt: fixtureChat.updatedAt },
      ],
    };
    expect(messageAcknowledged(message, answered)).toBe(true);
    expect(visibleMessage(message, answered)).toBeNull();
  });
  it("keeps a single bubble for uncertain retries and hides it in a different conversation", () => {
    const message = { ...queuedMessage("reply", "$50,000", fixtureChat), uncertain: true };
    expect(visibleMessage(message, fixtureChat)?.id).toBe("reply");
    expect(visibleMessage({ ...message, uncertain: false }, fixtureChat)?.id).toBe("reply");
    expect(visibleMessage(message, { ...fixtureChat, conversationId: "different" })).toBeNull();
  });
});
