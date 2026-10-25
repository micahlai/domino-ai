"use client";

import type { Constraint } from "@domino/contracts";
import { useState } from "react";
import { Button } from "../../ui/button";
import { Panel } from "./RunPanels";
import {
  type Option,
  RULE_KINDS,
  type RuleDraft,
  type RuleKind,
  buildConstraints,
  emptyRule,
  ruleDraftFrom,
} from "./drafts";
import { type Outcome, isConfirmed } from "./requests";

export const inputClass =
  "min-w-0 w-full max-w-full rounded-md border bg-background px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export type RuleEditorProps = {
  constraints: Constraint[];
  bills: Option[];
  onSave: (constraints: Constraint[], note: string) => Promise<Outcome>;
  disabled?: string;
};

/** Full replacement of the scenario's cash rules. Saving makes a new scenario; nothing is edited. */
export function RuleEditor({ constraints, bills, onSave, disabled }: RuleEditorProps) {
  const [drafts, setDrafts] = useState<RuleDraft[]>(() => constraints.map(ruleDraftFrom));
  const [note, setNote] = useState("");
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [addKind, setAddKind] = useState<RuleKind>("min_cash");

  const built = buildConstraints(drafts);
  const payload = built.ok && note.trim() ? JSON.stringify([built.value, note.trim()]) : null;
  const confirmed = isConfirmed(confirmedFor, payload);
  const update = (i: number, patch: Partial<RuleDraft>) =>
    setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  async function save() {
    if (!built.ok || !confirmed || pending) return;
    setPending(true);
    setError(undefined);
    const out = await onSave(built.value, note.trim());
    setPending(false);
    if (!out.ok) setError(out.message);
  }

  return (
    <Panel title="Cash rules to check" testId="rule-editor">
      <p className="text-xs text-muted-foreground">
        Cash minimums are checked at Sunday close, runway against forecast average monthly cash use,
        and bills against their payment deadlines. Checks cover these 13 weeks, not daily cash
        compliance. Saving creates a new scenario; earlier scenarios never change.
      </p>
      {drafts.length === 0 ? <p className="text-sm text-muted-foreground">No rules yet.</p> : null}
      <ul className="space-y-3">
        {drafts.map((d, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: drafts have no id until saved
          <li key={i} className="space-y-2 rounded-md border p-3" data-testid={`rule-${i}`}>
            <p className="text-xs text-muted-foreground">
              {RULE_KINDS.find((k) => k.kind === d.kind)?.title}
            </p>
            <label className="block space-y-1 text-xs">
              <span>Name</span>
              <input
                className={inputClass}
                value={d.label}
                onChange={(e) => update(i, { label: e.target.value })}
              />
            </label>
            {d.kind === "pay_by_date" ? (
              <label className="block space-y-1 text-xs">
                <span>Bill</span>
                <select
                  className={inputClass}
                  value={d.billId}
                  onChange={(e) => update(i, { billId: e.target.value })}
                >
                  <option value="">Choose a bill</option>
                  {/* Keep a saved bill visible even if it is no longer open. */}
                  {d.billId && !bills.some((b) => b.id === d.billId) ? (
                    <option value={d.billId}>{d.billId}</option>
                  ) : null}
                  {bills.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="block space-y-1 text-xs">
              <span>
                {d.kind === "min_cash"
                  ? "Minimum usable cash, in dollars"
                  : d.kind === "min_runway_months"
                    ? "Minimum months of cash"
                    : "Days late allowed after the due date"}
              </span>
              <input
                className={`${inputClass} font-mono`}
                inputMode="decimal"
                value={d.limit}
                onChange={(e) => update(i, { limit: e.target.value })}
              />
            </label>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDrafts((ds) => ds.filter((_, j) => j !== i))}
            >
              Remove this rule
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 max-w-full space-y-1 text-xs">
          <span>Add a rule</span>
          <select
            className={inputClass}
            value={addKind}
            onChange={(e) => setAddKind(e.target.value as RuleKind)}
          >
            {RULE_KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.title}
              </option>
            ))}
          </select>
        </label>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setDrafts((ds) => [...ds, emptyRule(addKind)])}
        >
          Add
        </Button>
      </div>
      <label className="block space-y-1 text-xs">
        <span>Why the rules change (saved with the scenario)</span>
        <textarea
          className={`${inputClass} h-16`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      {!built.ok ? (
        <ul className="space-y-0.5 text-xs text-destructive" data-testid="rule-errors">
          {built.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : !note.trim() ? (
        <p className="text-xs text-muted-foreground">Add a short note to save.</p>
      ) : null}
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={confirmed}
          disabled={payload === null}
          onChange={(e) => setConfirmedFor(e.target.checked ? payload : null)}
          data-testid="rule-confirm"
        />
        <span>I reviewed these rules. Check the forecast against exactly these.</span>
      </label>
      <Button
        onClick={save}
        disabled={!confirmed || pending || Boolean(disabled)}
        data-testid="rule-save"
      >
        {pending ? "Saving..." : "Save rules as a new scenario"}
      </Button>
      {disabled ? <p className="text-xs text-muted-foreground">{disabled}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </Panel>
  );
}
