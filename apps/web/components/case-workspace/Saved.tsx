"use client";

import { useQueries } from "convex/react";
import Link from "next/link";
import { type ReactNode, useMemo } from "react";
import { api } from "../../convex/_generated/api";
import { readConversation } from "../investigate/live/InvestigateLive";
import { type Adapted, type Conversation, adaptConversation } from "../investigate/live/adapt";
import { caseHref } from "./links";

// Read-only access to one saved investigation. Opening a page never starts, retries or advances
// anything: the only calls here are queries.

export type Saved =
  | { state: "loading" }
  | { state: "unavailable"; error: string }
  | { state: "ready"; conversation: Conversation; adapted: Adapted };

export function useSaved(conversationId: string): Saved {
  const queries = useMemo(
    () => ({
      conv: { query: api.investigation.getConversation, args: { conversationId } },
    }),
    [conversationId],
  );
  const raw = useQueries(queries) as { conv?: unknown };
  const read = readConversation(raw.conv, conversationId);
  const conversation = read.state === "ready" ? read.conversation : undefined;
  const adapted = useMemo(
    () => (conversation ? adaptConversation(conversation) : undefined),
    [conversation],
  );
  if (read.state === "ready" && conversation && adapted)
    return { state: "ready", conversation, adapted };
  return read.state === "unavailable"
    ? { state: "unavailable", error: read.error }
    : { state: "loading" };
}

export function Note({
  title,
  children,
  alert,
}: { title: string; children?: ReactNode; alert?: boolean }) {
  return (
    <div role={alert ? "alert" : "status"} className="rounded-lg border p-4 text-sm">
      <p className="font-medium">{title}</p>
      {children ? <div className="mt-1 text-muted-foreground">{children}</div> : null}
    </div>
  );
}

export function Pending({ saved }: { saved: Saved }) {
  return saved.state === "unavailable" ? (
    <Note alert title="This investigation could not be shown.">
      {saved.error}
    </Note>
  ) : (
    <Note title="Loading the saved investigation." />
  );
}

/** Same guard as the workspace: a missing deployment is stated, never staged. */
export function NeedsService({ children }: { children: ReactNode }) {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL)
    return (
      <Note alert title="Not connected.">
        This environment is not connected to the investigation service, so nothing saved can be
        read.
      </Note>
    );
  return children;
}

export function NoInvestigation() {
  return (
    <Note title="No investigation is open.">
      Ask a question in the{" "}
      <Link
        href={caseHref.workspace()}
        className="rounded text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      >
        workspace
      </Link>{" "}
      to start one. Its saved forecast and sources then appear here.
    </Note>
  );
}
