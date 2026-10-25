"use client";

import { useMutation, useQuery } from "convex/react";
import { Check, Lock } from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  JUDGE_LIMITS,
  JUDGE_SOURCES,
  JUDGE_STARTS,
  type JudgeSource,
  type JudgeStart,
  REQUIRED_SOURCE,
  SOURCE_NEEDS,
} from "../../convex/lib/judge";
import { cn } from "../../lib/utils";
import { ToolLogo } from "../icons/ToolLogo";
import { Button } from "../ui/button";
import { PageHeader } from "../ui/page";
import { JudgeWatch } from "./JudgeWatch";
import { SOURCE_TILE, readStored, storeJudgeCompany, subscribe } from "./flow";
import { errorText } from "./shared";

// Judge sandbox (/judge), three steps: pick a company story, pick its data sources, then watch
// the agent map grow from one agent for that fresh company. The company id lives in this
// browser only, so a reload returns to step 3.

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
export function JudgePage() {
  if (!CONVEX_URL)
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <PageHeader title="Try Domino on a company you pick" />
        <p className="text-sm text-muted-foreground">
          The sandbox needs the live backend. Set NEXT_PUBLIC_CONVEX_URL and reload.
        </p>
      </div>
    );
  return <LiveJudge />;
}

type Step = 1 | 2 | 3;

function LiveJudge() {
  const stored = useSyncExternalStore(subscribe, readStored, () => null);
  const companyId = stored as Id<"companies"> | null;
  const state = useQuery(api.fieldJudge.state, companyId ? { companyId } : "skip");
  const [step, setStep] = useState<1 | 2>(1);
  const [start, setStart] = useState<JudgeStart | null>(null);

  // A stored id that is gone or archived (reset from another tab) is forgotten.
  useEffect(() => {
    if (companyId && (state === null || state?.archived)) storeJudgeCompany(null);
  }, [companyId, state]);

  const active = state && !state.archived ? state : null;
  const current: Step = active ? 3 : step;

  if (companyId && state === undefined)
    return <p className="text-sm text-muted-foreground">Loading your company</p>;

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <Steps current={current} onBack={current === 2 ? () => setStep(1) : undefined} />
      {active ? (
        <JudgeWatch
          state={active}
          onLeave={() => {
            setStep(1);
            storeJudgeCompany(null);
          }}
        />
      ) : step === 1 ? (
        <PickCompany
          selected={start}
          onPick={(s) => {
            setStart(s);
            setStep(2);
          }}
        />
      ) : start ? (
        <PickSources start={start} onBack={() => setStep(1)} />
      ) : null}
    </div>
  );
}

const STEP_LABELS = ["Pick a company", "Pick data sources", "Watch it work"] as const;

function Steps({ current, onBack }: { current: Step; onBack?: () => void }) {
  return (
    <nav aria-label="Steps">
      <ol className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        {STEP_LABELS.map((label, i) => {
          const n = (i + 1) as Step;
          const done = n < current;
          const content = (
            <>
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                  done
                    ? "bg-foreground/10 text-foreground"
                    : n === current
                      ? "bg-foreground text-background"
                      : "bg-secondary text-muted-foreground",
                )}
              >
                {done ? <Check className="size-3.5" strokeWidth={3} /> : n}
              </span>
              <span
                className={n === current ? "font-medium text-foreground" : "text-muted-foreground"}
              >
                {label}
              </span>
            </>
          );
          return (
            <li
              key={label}
              aria-current={n === current ? "step" : undefined}
              className="flex items-center gap-2"
            >
              {n === 1 && onBack ? (
                <button
                  type="button"
                  onClick={onBack}
                  className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {content}
                </button>
              ) : (
                content
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function PickCompany({
  selected,
  onPick,
}: {
  selected: JudgeStart | null;
  onPick: (s: JudgeStart) => void;
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Pick a company"
        description="Each is the same kind of software business, about $21M a year in revenue, with a different cash story. You get your own fresh, simulated copy."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {JUDGE_STARTS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onPick(s)}
            className={cn(
              "group flex min-h-[148px] flex-col items-start gap-2 rounded-lg border bg-card p-[var(--card-pad)] text-left shadow-xs transition-colors",
              "hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              selected?.id === s.id && "border-foreground/60",
            )}
          >
            <span className="text-lg font-semibold tracking-[-0.015em]">{s.title}</span>
            <span className="text-sm leading-6 text-muted-foreground">{s.story}</span>
            <span className="mt-auto text-sm font-medium">{s.outcome}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PickSources({ start, onBack }: { start: JudgeStart; onBack: () => void }) {
  const startJudge = useMutation(api.fieldJudge.start);
  const running = useQuery(api.fieldJudge.companies, {});
  const [on, setOn] = useState<ReadonlySet<JudgeSource>>(() => new Set(JUDGE_SOURCES));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback((t: JudgeSource) => {
    if (t === REQUIRED_SOURCE) return;
    setOn((cur) => {
      const next = new Set(cur);
      if (!next.delete(t)) next.add(t);
      // Turning a tool off also turns off the tools that need it.
      for (const [tool, rule] of Object.entries(SOURCE_NEEDS))
        if (rule && !next.has(rule.needs)) next.delete(tool as JudgeSource);
      return next;
    });
  }, []);

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const sources = JUDGE_SOURCES.filter((t) => on.has(t));
      const { companyId } = await startJudge({ profile: start.profile, sources });
      storeJudgeCompany(companyId);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={start.title}
        title="Pick its data sources"
        description="Domino reads only the tools you connect, so turning one off hides what it knows. The bank is required: the forecast starts from its cash."
      />
      <fieldset>
        <legend className="sr-only">Data sources</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {JUDGE_SOURCES.map((t) => {
            const tile = SOURCE_TILE[t];
            const checked = on.has(t);
            const required = t === REQUIRED_SOURCE;
            const rule = SOURCE_NEEDS[t];
            const blocked = rule !== undefined && !on.has(rule.needs);
            return (
              <label
                key={t}
                className={cn(
                  "flex items-center gap-3 rounded-lg border bg-card p-4 shadow-xs transition-colors",
                  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2",
                  checked ? "border-foreground/60" : "opacity-60 hover:opacity-100",
                  required || blocked ? "cursor-default" : "cursor-pointer",
                )}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={checked}
                  disabled={required || blocked}
                  onChange={() => toggle(t)}
                  aria-describedby={`src-${t}`}
                />
                <ToolLogo vendor={tile.vendor} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{tile.name}</span>
                  <span id={`src-${t}`} className="block text-[13px] text-muted-foreground">
                    {required
                      ? "Required"
                      : blocked
                        ? `Needs ${SOURCE_TILE[rule.needs].name}`
                        : tile.gives}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded border",
                    checked ? "border-foreground bg-foreground text-background" : "border-input",
                  )}
                >
                  {required ? (
                    <Lock className="size-3" />
                  ) : checked ? (
                    <Check className="size-3.5" strokeWidth={3} />
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={onBack} disabled={busy}>
          Back
        </Button>
        <Button onClick={go} disabled={busy}>
          {busy ? "Starting" : `Start with ${on.size} of ${JUDGE_SOURCES.length} sources`}
        </Button>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : running ? (
          <p className="text-[13px] text-muted-foreground tabular-nums">
            {running.length} of {JUDGE_LIMITS.activeCompanies} sandbox companies running
          </p>
        ) : null}
      </div>
    </div>
  );
}
