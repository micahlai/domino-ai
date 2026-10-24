"use client";

import { useConvexConnectionState, useMutation, useQueries } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { api } from "../../../convex/_generated/api";
import { InvestigateWorkspace } from "../InvestigateWorkspace";
import type { CanvasConnection, CanvasNode } from "../types";
import { CompanyKnowledge } from "./CompanyKnowledge";
import { FinancialOutput } from "./FinancialOutput";
import { type Adapted, ConversationSchema, adaptConversation } from "./adapt";
import { conversationFromSearch, mayApplyCompletion, pendingPayload, sendRequest } from "./session";

const FOLLOW_UP =
  "This investigation answers one question. Start a new investigation to ask something else.";
const ErrorData = z.object({ code: z.string() });

type Phase = { pending?: boolean; error?: string };

/** Query state in words. Loading, missing, failed and malformed are all different. */
function readConversation(raw: unknown, wantedId: string) {
  if (raw === undefined) return { state: "loading" as const };
  if (raw instanceof Error) {
    const data = raw instanceof ConvexError ? ErrorData.safeParse(raw.data) : undefined;
    return {
      state: "unavailable" as const,
      error:
        data?.success && data.data.code === "NOT_FOUND"
          ? "That investigation was not found. Check the link, or start a new one."
          : "The investigation could not be loaded right now. Nothing was changed.",
    };
  }
  const parsed = ConversationSchema.safeParse(raw);
  if (!parsed.success || parsed.data.conversationId !== wantedId)
    return {
      state: "unavailable" as const,
      error: "The saved investigation was not in the expected shape, so it is not shown.",
    };
  return { state: "ready" as const, conversation: parsed.data };
}

function Frame({ children, fixed }: { children: ReactNode; fixed?: boolean }) {
  return (
    <div className="flex h-full flex-col">
      {fixed ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 border-b px-4 text-xs text-muted-foreground">
          <p className="py-2">
            One question per investigation. Domino follows fixed steps in order.
          </p>
          <Link
            href="/investigate"
            className="inline-flex min-h-11 items-center rounded text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            New investigation
          </Link>
        </div>
      ) : null}
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

function Session({ conversationId }: { conversationId?: string }) {
  const router = useRouter();
  const connection = useConvexConnectionState();
  const queries = useMemo(
    () => ({
      ...(conversationId
        ? { conv: { query: api.investigation.getConversation, args: { conversationId } } }
        : {}),
    }),
    [conversationId],
  );
  const raw = useQueries(queries) as { conv?: unknown };
  const investigate = useMutation(api.investigation.investigate);
  const reveal = useMutation(api.investigation.revealInvestigation);
  const alternative = useMutation(api.investigation.requestAlternative);
  const [phase, setPhase] = useState<Phase>({});
  const busy = useRef(false);

  // A replaced or unmounted session must not navigate or update state when its call finishes.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // A reload with an unconfirmed send: say so, and keep the same request for the retry.
  useEffect(() => {
    if (conversationId) return;
    const prior = pendingPayload("new");
    if (prior)
      setPhase({
        error: `An earlier question may have been recorded: “${prior}”. Send it again to retry safely; it will not be saved twice.`,
      });
  }, [conversationId]);

  // alive flips only in effect cleanup, after the address may already have changed, so also
  // compare the live address with the one this session started from.
  const stillHere = () =>
    mayApplyCompletion({
      alive: alive.current,
      pathname: window.location.pathname,
      search: window.location.search,
      originId: conversationId,
    });

  async function perform(
    scope: string,
    payload: string,
    call: (requestId: string) => Promise<unknown>,
  ) {
    if (busy.current) return;
    busy.current = true;
    setPhase({ pending: true });
    const outcome = await sendRequest({ scope, payload, call, stillHere });
    busy.current = false;
    if (outcome.kind === "stale") return;
    if (outcome.kind === "failed") {
      // The draft is already cleared, so a lost new question is quoted back to retry it.
      const quote = !conversationId ? ` Your question was: “${payload}”` : "";
      return setPhase({ error: outcome.message + quote });
    }
    setPhase({});
    if (!conversationId) {
      const next = new URLSearchParams(window.location.search);
      next.set("c", outcome.conversationId);
      router.replace(`${window.location.pathname}?${next.toString()}`, { scroll: false });
    }
  }

  const read = conversationId ? readConversation(raw.conv, conversationId) : undefined;
  const ready = read?.state === "ready" ? read.conversation : undefined;
  const adapted = useMemo<Adapted | undefined>(
    () => (ready ? adaptConversation(ready) : undefined),
    [ready],
  );

  const renderOutput = useCallback(
    (node: CanvasNode) => {
      const target = adapted?.outputs.get(node.id);
      return target ? <FinancialOutput target={target} /> : null;
    },
    [adapted],
  );

  // The saved baseline comes from the succeeded forecast step (every output carries it), never
  // from the newest run. Keyed by run so another session's packet cannot linger.
  const baselineRunId = adapted ? [...adapted.outputs.values()][0]?.baselineRunId : undefined;
  const renderKnowledge = useCallback(
    () => <CompanyKnowledge key={baselineRunId ?? "pending"} runId={baselineRunId} />,
    [baselineRunId],
  );

  const offline = !connection.isWebSocketConnected && connection.connectionRetries > 0;
  const state: CanvasConnection = offline
    ? "offline"
    : read?.state === "loading"
      ? "loading"
      : read?.state === "unavailable"
        ? "unavailable"
        : "live";

  const onSend = (text: string) => {
    if (conversationId) return setPhase({ error: FOLLOW_UP });
    const question = text.trim();
    void perform("new", question, (requestId) => investigate({ requestId, question }));
  };
  const act = (kind: "reveal" | "alternative") => () => {
    if (!conversationId) return;
    const call = kind === "reveal" ? reveal : alternative;
    void perform(`${conversationId}:${kind}`, "", (requestId) =>
      call({ requestId, conversationId }),
    );
  };

  return (
    <Frame fixed={!!conversationId}>
      <InvestigateWorkspace
        sessionId={conversationId}
        connection={state}
        // Loading history is an empty list, not the idle Domino; a failed read keeps the idle one.
        nodes={adapted?.nodes ?? (read?.state === "loading" ? [] : undefined)}
        edges={adapted?.edges}
        messages={adapted?.messages}
        pending={phase.pending || ready?.busy}
        error={phase.error ?? (read?.state === "unavailable" ? read.error : undefined)}
        onSend={onSend}
        onReveal={act("reveal")}
        onAlternative={act("alternative")}
        canReveal={ready?.canReveal}
        canAlternative={ready?.canAlternative}
        renderOutput={renderOutput}
        renderKnowledge={renderKnowledge}
      />
    </Frame>
  );
}

function Connected() {
  const params = useSearchParams();
  const id = conversationFromSearch(params.toString());
  // A different conversation is a different session: action state and request ids start clean.
  return <Session key={id ?? "new"} conversationId={id} />;
}

export function InvestigateLive() {
  // Missing deployment stays honestly unavailable; nothing is staged in its place.
  if (!process.env.NEXT_PUBLIC_CONVEX_URL)
    return (
      <InvestigateWorkspace
        connection="unavailable"
        error="This environment is not connected to the investigation service, so nothing can be sent."
      />
    );
  return <Connected />;
}
