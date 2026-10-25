"use client";

import type { ProfileId } from "@domino/sim";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Check } from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { FIELD_COMPANIES } from "../../convex/lib/fieldCompanies";
import { CHECKLIST_STEPS, type ChecklistStep } from "../../convex/lib/judge";
import { cn } from "../../lib/utils";
import type { LiveLogRow } from "../field/live";
import { Button } from "../ui/button";
import { PageHeader, Section } from "../ui/page";
import { Select } from "../ui/select";
import { CsvImport } from "./CsvImport";
import { FlagsPanel } from "./FlagsPanel";
import { LivePanel } from "./LivePanel";
import { ScenarioForm } from "./ScenarioForm";
import { ProofLabel, clockTime, errorText } from "./shared";

// Judge sandbox (/judge): one isolated simulated company per judge, a scenario form, the live
// reaction and the decision record. The chosen company id lives in this browser only.

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
const KEY = "domino.judge.company";
const EVENT = "domino:judge-company";

type JudgeState = NonNullable<FunctionReturnType<typeof api.fieldJudge.state>>;

const STARTS: { id: ProfileId; label: string }[] = [
  { id: "kestrel", label: "Healthy company" },
  { id: "kestrel-late", label: "Customers already pay late" },
  { id: "kestrel-churn", label: "Biggest customer leaving" },
  { id: "kestrel-crunch", label: "Cash crunch" },
];

const HINT: Record<ChecklistStep["id"], string> = {
  start: "A fresh simulated company, only yours",
  scenario: "Pick what happens below",
  watch: "Agents re-read the books in seconds",
  decide: "Confirm or dismiss a flag",
  record: "Your decision is in the record",
};

function readStored(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
function store(id: string | null) {
  try {
    if (id) window.localStorage.setItem(KEY, id);
    else window.localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the company still works until the page reloads.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function JudgePage() {
  if (!CONVEX_URL)
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <PageHeader eyebrow="Judge sandbox" title="Try Domino on a company you control" />
        <p className="text-sm text-muted-foreground">
          The sandbox needs the live backend. Set NEXT_PUBLIC_CONVEX_URL and reload.
        </p>
      </div>
    );
  return <LiveJudge />;
}

function LiveJudge() {
  const stored = useSyncExternalStore(subscribe, readStored, () => null);
  const companyId = stored as Id<"companies"> | null;
  const state = useQuery(api.fieldJudge.state, companyId ? { companyId } : "skip");
  const start = useMutation(api.fieldJudge.start);
  const reset = useMutation(api.fieldJudge.reset);
  const [profile, setProfile] = useState<ProfileId>("kestrel");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A stored id that is gone or archived (reset from another tab) is forgotten.
  useEffect(() => {
    if (companyId && (state === null || state?.archived)) store(null);
  }, [companyId, state]);

  const active = state && !state.archived ? state : null;
  const run = useCallback(async (fn: () => Promise<{ companyId: Id<"companies"> }>) => {
    setBusy(true);
    setError(null);
    try {
      store((await fn()).companyId);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const steps: ChecklistStep[] =
    active?.checklist ?? CHECKLIST_STEPS.map((s) => ({ ...s, done: false }));

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <PageHeader
        eyebrow={active ? `Judge sandbox · ${active.name}` : "Judge sandbox"}
        title="Try Domino on a company you control"
        description="A fresh simulated company just for you. Add a scenario, watch the real agents react, then decide what they flag."
        actions={
          <>
            <label className="sr-only" htmlFor="judge-start-profile">
              Starting point
            </label>
            <div className="w-60">
              <Select
                id="judge-start-profile"
                value={profile}
                onChange={(e) => setProfile(e.target.value as ProfileId)}
              >
                {STARTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    Start from: {s.label}
                  </option>
                ))}
              </Select>
            </div>
            <Button disabled={busy} onClick={() => run(() => start({ profile }))}>
              Start a fresh company
            </Button>
            {active ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => run(() => reset({ companyId: active.companyId }))}
              >
                Reset
              </Button>
            ) : null}
          </>
        }
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Checklist steps={steps} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card px-4 py-3 text-[13px] text-muted-foreground shadow-xs">
        <ProofLabel kind="simulated" />
        <span>The company and its six tools (Stripe, bank, books, cards, payroll, CRM).</span>
        <ProofLabel kind="real" />
        <span>Ingestion, audit, forecast, analyst agents, AI calls and your decisions.</span>
      </div>
      {companyId && state === undefined ? (
        <p className="text-sm text-muted-foreground">Loading your company</p>
      ) : active ? (
        <Workspace state={active} />
      ) : (
        <Section>
          <div className="space-y-2 py-6 text-center">
            <p className="text-[15px] font-semibold">No sandbox company yet</p>
            <p className="text-sm text-muted-foreground">
              Pick a starting point above and press Start a fresh company. It takes about five
              seconds for the agents to read its books.
            </p>
          </div>
        </Section>
      )}
    </div>
  );
}

function Checklist({ steps }: { steps: ChecklistStep[] }) {
  const current = steps.findIndex((s) => !s.done);
  return (
    <nav aria-label="Guided steps">
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {steps.map((s, i) => (
          <li
            key={s.id}
            aria-current={i === current ? "step" : undefined}
            className={cn(
              "flex items-start gap-3 rounded-lg border bg-card p-3 shadow-xs",
              i === current && "border-foreground/60",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                s.done
                  ? "bg-safe text-white"
                  : i === current
                    ? "bg-foreground text-background"
                    : "bg-secondary text-muted-foreground",
              )}
            >
              {s.done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">
                {s.label}
                <span className="sr-only">{s.done ? " (done)" : " (not done yet)"}</span>
              </span>
              <span className="block text-xs text-muted-foreground">{HINT[s.id]}</span>
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Workspace({ state }: { state: JudgeState }) {
  const log = usePaginatedQuery(
    api.field.log,
    { companyId: state.companyId },
    {
      initialNumItems: 150,
    },
  );
  const rows = log.results as LiveLogRow[];
  const story = FIELD_COMPANIES.find((c) => c.id === state.profile)?.story;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="min-w-0 space-y-6">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{state.name}</span>, books as of{" "}
          {state.asOf}. {story ? `Started from: ${story}.` : ""}
        </p>
        <ScenarioForm
          companyId={state.companyId}
          ready={state.snapshotVersion > 0}
          usedThisMinute={state.limits.usedThisMinute}
          perMinute={state.limits.perMinute}
        />
        <FlagsPanel companyId={state.companyId} />
        <CsvImport companyId={state.companyId} asOf={state.asOf} />
      </div>
      <div className="min-w-0 space-y-6">
        <LivePanel companyId={state.companyId} rows={rows} version={state.snapshotVersion} />
        <RecordPanel state={state} />
      </div>
    </div>
  );
}

const DECIDED = { approved: "Confirmed issue", rejected: "Dismissed flag" } as const;

function RecordPanel({ state }: { state: JudgeState }) {
  const items = [
    ...state.history.map((h) => ({ at: h.at, type: "scenario" as const, h })),
    ...state.decisions.map((d) => ({ at: d.at, type: "decision" as const, d })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));
  return (
    <Section
      title="The record"
      description="Every change you made and every decision, with the ids that trace it."
      actions={<ProofLabel kind="real">Real audit trail</ProofLabel>}
      flush
    >
      {items.length === 0 ? (
        <p className="p-[var(--card-pad)] text-sm text-muted-foreground">
          Nothing yet. Your scenarios and decisions will appear here.
        </p>
      ) : (
        <ol className="divide-y">
          {items.slice(0, 30).map((item) =>
            item.type === "scenario" ? (
              <li
                key={`s-${item.at}-${item.h.kind}`}
                className="space-y-1 px-[var(--card-pad)] py-3"
              >
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="font-medium">You planted: {item.h.label}</span>
                  <ProofLabel kind="simulated" />
                  <time
                    className="ml-auto text-xs tabular-nums text-muted-foreground"
                    dateTime={item.at}
                  >
                    {clockTime(item.at)}
                  </time>
                </div>
                <p className="text-sm leading-6 text-muted-foreground">{item.h.summary}</p>
                <Ids label="Planted records" ids={item.h.refs} />
              </li>
            ) : (
              <li key={`d-${item.d.approvalId}`} className="space-y-1 px-[var(--card-pad)] py-3">
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="font-medium">
                    {DECIDED[item.d.decision]} by{" "}
                    {item.d.by.includes("demo-user") ? "you (demo sign-in)" : item.d.by}
                  </span>
                  {item.d.logged ? (
                    <span className="inline-flex items-center gap-1 text-xs text-safe">
                      <Check aria-hidden="true" className="size-3" /> In the action log
                    </span>
                  ) : null}
                  <time
                    className="ml-auto text-xs tabular-nums text-muted-foreground"
                    dateTime={item.at}
                  >
                    {clockTime(item.at)}
                  </time>
                </div>
                <p className="text-sm leading-6 text-muted-foreground">{item.d.summary}</p>
                {item.d.note ? <p className="text-sm">Note: {item.d.note}</p> : null}
                <Ids label="Approval" ids={[item.d.approvalId]} />
                <Ids label="Flag" ids={[item.d.findingId]} />
              </li>
            ),
          )}
        </ol>
      )}
    </Section>
  );
}

function Ids({ label, ids }: { label: string; ids: string[] }) {
  if (ids.length === 0) return null;
  return (
    <p className="break-all text-xs text-muted-foreground">
      {label}:{" "}
      <code className="font-mono text-[11px] text-foreground/80">
        {ids.slice(0, 6).join(", ")}
        {ids.length > 6 ? ` +${ids.length - 6} more` : ""}
      </code>
    </p>
  );
}
