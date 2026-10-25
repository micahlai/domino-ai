"use client";
import { useState } from "react";
import { Button } from "../../ui/button";
import { WorkspaceView } from "../workspace/WorkspaceView";
import { workspaceHref } from "../workspace/api";
import { fixtureGraph, fixtureRoot, fixtureRules, fixtureScenario } from "../workspace/fixtures";
import { ChatView } from "./ChatView";
import { fixtureChat, fixtureChatRun, fixtureReady, fixtureSaved } from "./fixtures";
export function ChatPlayground() {
  const [mode, setMode] = useState<"new" | "clarify" | "ready" | "saved" | "error">("clarify");
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
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
      <WorkspaceView
        key={mode}
        run={fixtureChatRun}
        parent={null}
        graph={{ state: "ready", value: fixtureGraph }}
        questions={{ state: "ready", value: [] }}
        resultRef={{ state: "missing" }}
        comparisons={{
          ids: comparisonIds,
          reads: {
            [fixtureRoot.runId]: { state: "ready", value: fixtureRoot },
            [fixtureRules.runId]: { state: "ready", value: fixtureRules },
            [fixtureScenario.runId]: { state: "ready", value: fixtureScenario },
          },
          onChange: setComparisonIds,
        }}
        actions={{
          catalogHref: "#",
          hrefFor: (runId) => workspaceHref(fixtureChatRun.companyId, { runId }),
          simulate: async () => ({ ok: false, message: "Fixture only: nothing was calculated." }),
          reviseRules: async () => ({ ok: false, message: "Fixture only: nothing was saved." }),
          ask: async () => ({ ok: false, message: "Fixture only: nothing was saved." }),
          confirmProposal: async () => ({ ok: false, message: "Fixture only: nothing was saved." }),
          relink: async () => ({ ok: false, message: "Fixture only: nothing was saved." }),
        }}
        chat={(context) => (
          <ChatView
            sidebar
            {...context}
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
              value: [
                fixtureChat,
                { ...fixtureSaved, conversationId: "timeline:chat/saved-fixture" },
              ],
            }}
            actions={{
              write: async () => ({
                ok: false,
                message: "This is a visual fixture. Open a connected saved timeline to chat.",
              }),
            }}
          />
        )}
      />
    </div>
  );
}
