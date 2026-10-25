"use client";
import { useMutation, useQueries } from "convex/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Skeleton } from "../../ui/skeleton";
import { ReadNotice } from "../workspace/CatalogPanel";
import { type WorkspaceRun, getRunRef, readRun, workspaceHref } from "../workspace/api";
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
  const send = useMutation(sendRef);
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
      router.push(chatHref(run.companyId, run.runId, result.receipt.conversationId));
    return result;
  }
  return (
    <ChatView
      key={conversationId ?? `new:${selectedWeek ?? ""}:${selectedItemId ?? ""}`}
      run={run}
      selected={conversationId ? readChat(raw.selected, { ...key, conversationId }, run) : null}
      history={readChats(raw.history, key, run)}
      actions={{ write }}
      selectedWeek={selectedWeek}
      selectedItemId={selectedItemId}
    />
  );
}
function Connected({ companyId }: { companyId: string }) {
  const params = useSearchParams();
  const runId = params.get("runId");
  const conversationId = params.get("conversationId");
  const queries = useMemo(
    () => (runId ? { run: { query: getRunRef, args: { companyId, runId } } } : {}),
    [companyId, runId],
  );
  const raw = useQueries(queries as Parameters<typeof useQueries>[0]) as Record<string, unknown>;
  if (!runId)
    return (
      <div className="space-y-3 rounded-lg border p-5 text-sm">
        <p>Choose a saved timeline before starting a chat.</p>
        <Link href={workspaceHref(companyId)} className="text-primary hover:underline">
          Open saved timelines
        </Link>
      </div>
    );
  const read = readRun(raw.run, { companyId, runId });
  if (read.state !== "ready") return <ReadNotice read={read} what="source timeline" />;
  return (
    <Ready
      key={`${companyId}:${runId}`}
      run={read.value}
      conversationId={conversationId}
      selectedWeek={params.get("selectedWeek") ?? undefined}
      selectedItemId={params.get("selectedItemId") ?? undefined}
    />
  );
}
export function ChatLive({ companyId }: { companyId: string }) {
  return (
    <Suspense
      fallback={
        <div aria-busy="true" className="space-y-3">
          <p className="text-sm text-muted-foreground">Opening the saved conversation…</p>
          <Skeleton className="h-40 w-full" />
        </div>
      }
    >
      {process.env.NEXT_PUBLIC_CONVEX_URL ? (
        <Connected companyId={companyId} />
      ) : (
        <p role="alert" className="rounded-lg border p-5 text-sm">
          This page is not connected to the timeline service, so conversations cannot be read or
          saved.
        </p>
      )}
    </Suspense>
  );
}
