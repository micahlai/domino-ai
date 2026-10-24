"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Conversation } from "../investigate/live/adapt";
import { NeedsService, NoInvestigation, Note, Pending, useSaved } from "./Saved";
import { caseHref } from "./links";
import { summarize } from "./summary";

// The list of every saved investigation needs a catalog read that does not exist yet. Until it
// does, this page shows only the investigation that is open, from its real saved record.

const openLink =
  "inline-flex min-h-11 items-center rounded text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";

export function SimulationRow({ conversation }: { conversation: Conversation }) {
  const { question, status, branches } = summarize(conversation);
  return (
    <li className="rounded-lg border p-4">
      <p className="font-medium">{question ?? "Saved investigation"}</p>
      <p className="mt-1 text-sm text-muted-foreground">{status}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {branches.length ? branches.join(" · ") : "Nothing saved yet"}
      </p>
      <Link href={caseHref.detail(conversation.conversationId)} className={openLink}>
        Open details
      </Link>
    </li>
  );
}

function Open({ id }: { id: string }) {
  const saved = useSaved(id);
  return saved.state === "ready" ? (
    <ul>
      <SimulationRow conversation={saved.conversation} />
    </ul>
  ) : (
    <Pending saved={saved} />
  );
}

export function SimulationList() {
  const id = useSearchParams().get("c") || undefined;
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 md:py-8">
      <div>
        <h2 className="text-xl font-medium">Simulations</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Investigations Domino has saved, and the branches each one produced.
        </p>
      </div>
      <Note title="The full list is not available yet.">
        Saved investigations cannot be listed across sessions. Only the one you have open is shown,
        and others can be opened from their own link.
      </Note>
      <NeedsService>{id ? <Open id={id} /> : <NoInvestigation />}</NeedsService>
    </div>
  );
}
