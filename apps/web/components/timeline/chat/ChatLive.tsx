"use client";
import { useAction, useMutation, useQueries } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { WorkspaceRun } from "../workspace/api";
import { RequestLedger } from "../workspace/requests";
import { ChatView } from "./ChatView";
import {
  beginRef,
  chatHref,
  confirmRef,
  getChatRef,
  listChatsRef,
  readChat,
  readChats,
  resetRef,
  sendRef,
} from "./api";
import { type ChatCommand, ChatNavigationGuard, requestChat } from "./requests";
function Ready({
  run,
  conversationId,
  selectedWeek,
  selectedItemId,
}: {
  run: WorkspaceRun;
  conversationId: string | null;
  selectedWeek?: string;
  selectedItemId?: string;
}) {
  const router = useRouter();
  const key = useMemo(
    () => ({ companyId: run.companyId, runId: run.runId }),
    [run.companyId, run.runId],
  );
  const queries = useMemo(
    () => ({
      history: { query: listChatsRef, args: key },
      ...(conversationId
        ? { selected: { query: getChatRef, args: { companyId: run.companyId, conversationId } } }
        : {}),
    }),
    [key, conversationId, run.companyId],
  );
  const raw = useQueries(queries) as Record<string, unknown>;
  const begin = useMutation(beginRef);
  const send = useAction(sendRef);
  const reset = useMutation(resetRef);
  const confirm = useMutation(confirmRef);
  const [ledger] = useState(() => new RequestLedger());
  const [navigation] = useState(() => new ChatNavigationGuard());
  navigation.setContext(
    JSON.stringify([run.companyId, run.runId, conversationId, selectedWeek, selectedItemId]),
  );
  useEffect(() => {
    navigation.activate();
    return () => navigation.dispose();
  }, [navigation]);
  async function write(command: ChatCommand) {
    const context = navigation.capture();
    const result = await requestChat(run, command, ledger, { begin, send, reset, confirm });
    if (result.ok && command.kind === "begin" && navigation.allows(context))
      router.push(
        chatHref(
          run.companyId,
          run.runId,
          result.receipt.conversationId,
          result.receipt.selectedWeek ?? undefined,
          result.receipt.selectedItemId ?? undefined,
        ),
      );
    return result;
  }
  return (
    <ChatView
      // Stable across a new conversation's first message, which starts it and changes the URL;
      // the shown conversation still follows the URL through `selected`.
      key={run.runId}
      run={run}
      selected={conversationId ? readChat(raw.selected, { ...key, conversationId }, run) : null}
      history={readChats(raw.history, key, run)}
      actions={{ write, beginNavigates: true }}
      selectedWeek={selectedWeek}
      selectedItemId={selectedItemId}
    />
  );
}
/** Reuses the timeline's already validated saved source; opening the page never starts a chat. */
export function ChatSidebarLive({
  run,
  selectedWeek,
  selectedItemId,
}: {
  run: WorkspaceRun;
  selectedWeek?: string;
  selectedItemId?: string;
}) {
  const params = useSearchParams();
  return (
    <Ready
      key={`${run.companyId}:${run.runId}`}
      run={run}
      conversationId={params.get("conversationId")}
      selectedWeek={selectedWeek}
      selectedItemId={selectedItemId}
    />
  );
}
