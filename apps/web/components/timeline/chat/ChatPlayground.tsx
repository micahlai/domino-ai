"use client";
import { useState } from "react";
import { Button } from "../../ui/button";
import { ChatView } from "./ChatView";
import { fixtureChat, fixtureChatRun, fixtureReady, fixtureSaved } from "./fixtures";
export function ChatPlayground() {
  const [mode, setMode] = useState<"new" | "clarify" | "ready" | "saved" | "error">("clarify");
  const receipt = mode === "ready" ? fixtureReady : mode === "saved" ? fixtureSaved : fixtureChat;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Labelled fixtures only. These controls show saved states; they do not calculate or write
        data.
      </p>
      <div className="flex flex-wrap gap-2">
        {(["new", "clarify", "ready", "saved", "error"] as const).map((value) => (
          <Button
            key={value}
            variant={mode === value ? "default" : "outline"}
            onClick={() => setMode(value)}
          >
            {value}
          </Button>
        ))}
      </div>
      <ChatView
        key={mode}
        run={fixtureChatRun}
        selected={
          mode === "new"
            ? null
            : mode === "error"
              ? { state: "error" }
              : { state: "ready", value: receipt }
        }
        history={{
          state: "ready",
          value: [fixtureChat, { ...fixtureSaved, conversationId: "timeline:chat/saved-fixture" }],
        }}
        actions={{
          write: async () => ({
            ok: false,
            message: "This is a visual fixture. Open a connected saved timeline to chat.",
          }),
        }}
      />
    </div>
  );
}
