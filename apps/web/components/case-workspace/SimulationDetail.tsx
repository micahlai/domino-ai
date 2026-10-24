"use client";

import Link from "next/link";
import { type KeyboardEvent, type ReactNode, useId, useState } from "react";
import { cn } from "../../lib/utils";
import { STATUS_LABEL } from "../investigate/graph";
import { FinancialOutput } from "../investigate/live/FinancialOutput";
import { InvestigateLive } from "../investigate/live/InvestigateLive";
import type { Adapted, Conversation } from "../investigate/live/adapt";
import { NeedsService, Note, Pending, useSaved } from "./Saved";
import { caseHref } from "./links";
import { summarize } from "./summary";

const TABS = ["Overview", "Impact chain", "Chart", "Execution"] as const;
type Tab = (typeof TABS)[number];

const linkClass =
  "inline-flex min-h-11 items-center rounded text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";

function Overview({ conversation, adapted }: { conversation: Conversation; adapted: Adapted }) {
  const { question, status, branches } = summarize(conversation);
  const assessments = conversation.messages.filter((m) => m.kind === "assessment");
  // Steps only: the Domino and result nodes are layout, not recorded work.
  const steps = adapted.nodes.filter((n) => n.kind !== "domino" && n.kind !== "output");
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-medium">{question ?? "Saved investigation"}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{status}</p>
      </div>
      <section aria-labelledby="ov-saved">
        <h3 id="ov-saved" className="text-sm font-medium">
          What is saved
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {branches.length ? branches.join(" · ") : "Nothing yet."}
        </p>
      </section>
      {assessments.length > 0 ? (
        <section aria-labelledby="ov-said">
          <h3 id="ov-said" className="text-sm font-medium">
            What Domino said
          </h3>
          {assessments.map((m) => (
            <p key={m.id} className="mt-1 whitespace-pre-line text-sm leading-6">
              {m.text}
            </p>
          ))}
        </section>
      ) : null}
      <section aria-labelledby="ov-steps">
        <h3 id="ov-steps" className="text-sm font-medium">
          Steps
        </h3>
        <ul className="mt-1 divide-y text-sm">
          {steps.map((n) => (
            <li key={n.id} className="py-2">
              <span>{n.title}</span>{" "}
              <span className="text-muted-foreground">· {STATUS_LABEL[n.status]}</span>
              {n.error ? <span className="block text-muted-foreground">{n.error}</span> : null}
            </li>
          ))}
        </ul>
      </section>
      <Link href={caseHref.workspace(conversation.conversationId)} className={linkClass}>
        Open in the workspace
      </Link>
    </div>
  );
}

// No event, response or financial link has been computed for any saved investigation yet, so the
// chain says that rather than drawing the recorded steps as if they were cause and effect.
function ImpactChain() {
  return (
    <div className="max-w-3xl space-y-3">
      <h2 className="text-xl font-medium">Impact chain</h2>
      <Note title="Not computed yet.">
        This investigation has no modeled event, so no chain of financial effects is drawn and none
        is estimated here. The steps Domino ran are listed under Execution; they are an order of
        work, not cause and effect. The saved forecast and any costed alternative are under Chart.
      </Note>
    </div>
  );
}

function Chart({ conversation, adapted }: { conversation: Conversation; adapted: Adapted }) {
  const targets = [...adapted.outputs.entries()];
  const [picked, setPicked] = useState<string>();
  if (targets.length === 0)
    return (
      <Note title="No chart yet.">
        {conversation.busy
          ? "Domino is still working. The saved forecast appears here when its step finishes."
          : "No forecast step has finished, so there is nothing saved to draw."}
      </Note>
    );
  const [id, target] =
    targets.find(([key]) => key === picked) ??
    (targets[targets.length - 1] as (typeof targets)[number]);
  return (
    <div className="space-y-4">
      {targets.length > 1 ? (
        <fieldset className="m-0 flex min-w-0 flex-wrap gap-1 border-0 p-0">
          <legend className="sr-only">Saved result</legend>
          {targets.map(([key]) => {
            const title = adapted.nodes.find((n) => n.id === key)?.title ?? "Saved result";
            return (
              <button
                key={key}
                type="button"
                aria-pressed={key === id}
                onClick={() => setPicked(key)}
                className={cn(
                  "min-h-11 rounded-lg border px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
                  key === id ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {title}
              </button>
            );
          })}
        </fieldset>
      ) : null}
      <FinancialOutput key={id} target={target} />
    </div>
  );
}

function Tabs({
  tab,
  onTab,
  children,
}: { tab: Tab; onTab: (t: Tab) => void; children: ReactNode }) {
  const base = useId();
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    const to =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? TABS.length - 1
          : step === undefined
            ? -1
            : (TABS.indexOf(tab) + step + TABS.length) % TABS.length;
    if (to < 0) return;
    event.preventDefault();
    onTab(TABS[to] as Tab);
    (event.currentTarget.children[to] as HTMLElement | undefined)?.focus();
  };
  return (
    <>
      <div
        role="tablist"
        aria-label="Simulation"
        onKeyDown={move}
        className="flex flex-wrap gap-1 border-b pb-1"
      >
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            id={`${base}-${name}`}
            aria-selected={tab === name}
            aria-controls={`${base}-panel`}
            tabIndex={tab === name ? 0 : -1}
            onClick={() => onTab(name)}
            className={cn(
              "min-h-11 rounded-lg px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
              tab === name ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {name}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-${tab}`} className="pt-4">
        {children}
      </div>
    </>
  );
}

export function SimulationDetailView({
  conversation,
  adapted,
  initialTab = "Overview",
}: { conversation: Conversation; adapted: Adapted; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const id = conversation.conversationId;
  return (
    <Tabs tab={tab} onTab={setTab}>
      {tab === "Overview" ? <Overview conversation={conversation} adapted={adapted} /> : null}
      {tab === "Impact chain" ? <ImpactChain /> : null}
      {tab === "Chart" ? <Chart conversation={conversation} adapted={adapted} /> : null}
      {tab === "Execution" ? (
        <div className="h-[85dvh] min-h-[32rem] overflow-hidden rounded-lg border">
          <InvestigateLive
            place={{ path: caseHref.detail(id), newHref: caseHref.workspace(), id }}
          />
        </div>
      ) : null}
    </Tabs>
  );
}

function Loaded({ id }: { id: string }) {
  const saved = useSaved(id);
  return saved.state === "ready" ? (
    <SimulationDetailView conversation={saved.conversation} adapted={saved.adapted} />
  ) : (
    <Pending saved={saved} />
  );
}

export function SimulationDetail({ conversationId }: { conversationId: string }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:py-8">
      <Link href={caseHref.simulations(conversationId)} className={linkClass}>
        All simulations
      </Link>
      <NeedsService>
        <Loaded id={conversationId} />
      </NeedsService>
    </div>
  );
}
