"use client";

import type { Change } from "@domino/contracts";
import { useState } from "react";
import { Button } from "../../ui/button";
import { formatExactCents } from "../baseline/format";
import { inputClass } from "./RuleEditor";
import { Panel } from "./RunPanels";
import {
  EVENT_KINDS,
  type EventDraft,
  type EventKind,
  type Option,
  buildChange,
  changeText,
  emptyEvent,
} from "./drafts";
import { type Outcome, isConfirmed } from "./requests";

export type EventFormProps = {
  firstWeek: string;
  invoices: Option[];
  bills: Option[];
  /** A draft suggested by the chosen scheduled item; replaces the form when it changes. */
  suggestion?: EventDraft;
  onRun: (label: string, changes: Change[]) => Promise<Outcome>;
  disabled?: string;
};

/** Explicit future events, run together as one new scenario after the person confirms them. */
export function EventForm(p: EventFormProps) {
  const [draft, setDraft] = useState<EventDraft>(() => p.suggestion ?? emptyEvent());
  const [seenSuggestion, setSeenSuggestion] = useState(p.suggestion);
  const [changes, setChanges] = useState<Change[]>([]);
  const [label, setLabel] = useState("");
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [tried, setTried] = useState(false);

  // Adopt a newly chosen item without an effect (render-time state sync).
  if (p.suggestion !== seenSuggestion) {
    setSeenSuggestion(p.suggestion);
    if (p.suggestion) setDraft(p.suggestion);
  }

  const built = buildChange(draft, p.firstWeek);
  const payload = changes.length && label.trim() ? JSON.stringify([label.trim(), changes]) : null;
  const confirmed = isConfirmed(confirmedFor, payload);
  const set = (patch: Partial<EventDraft>) => setDraft((d) => ({ ...d, ...patch }));

  function add() {
    setTried(true);
    if (!built.ok) return;
    setChanges((cs) => [...cs, built.value]);
    setDraft(emptyEvent(draft.kind));
    setTried(false);
  }

  async function run() {
    if (!payload || !confirmed || pending) return;
    setPending(true);
    setError(undefined);
    const out = await p.onRun(label.trim(), changes);
    setPending(false);
    if (!out.ok) setError(out.message);
  }

  const needsInvoice = draft.kind === "delay_invoice" || draft.kind === "lose_invoice";
  const needsDays = draft.kind === "delay_invoice" || draft.kind === "delay_bill";
  const needsMoney = draft.kind === "add_cash" || draft.kind === "remove_cash";

  return (
    <Panel title="Add an event" testId="event-form">
      <label className="block space-y-1 text-xs">
        <span>What happens</span>
        <select
          className={inputClass}
          value={draft.kind}
          onChange={(e) => setDraft(emptyEvent(e.target.value as EventKind))}
          data-testid="event-kind"
        >
          {EVENT_KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.title}
            </option>
          ))}
        </select>
      </label>
      {needsInvoice ? (
        <label className="block space-y-1 text-xs">
          <span>Invoice</span>
          <select
            className={inputClass}
            value={draft.invoiceId}
            onChange={(e) => set({ invoiceId: e.target.value })}
          >
            <option value="">Choose an open invoice</option>
            {p.invoices.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {draft.kind === "delay_bill" ? (
        <label className="block space-y-1 text-xs">
          <span>Bill</span>
          <select
            className={inputClass}
            value={draft.billId}
            onChange={(e) => set({ billId: e.target.value })}
          >
            <option value="">Choose an unpaid bill</option>
            {p.bills.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {needsDays ? (
        <label className="block space-y-1 text-xs">
          <span>Days late</span>
          <input
            className={`${inputClass} font-mono`}
            inputMode="numeric"
            value={draft.days}
            onChange={(e) => set({ days: e.target.value })}
          />
        </label>
      ) : null}
      {needsMoney ? (
        <>
          <label className="block space-y-1 text-xs">
            <span>Date (on or after the week of {p.firstWeek})</span>
            <input
              type="date"
              className={inputClass}
              min={p.firstWeek}
              value={draft.date}
              onChange={(e) => set({ date: e.target.value })}
            />
          </label>
          <label className="block space-y-1 text-xs">
            <span>Amount, in dollars</span>
            <input
              className={`${inputClass} font-mono`}
              inputMode="decimal"
              value={draft.amount}
              onChange={(e) => set({ amount: e.target.value })}
            />
          </label>
          <label className="block space-y-1 text-xs">
            <span>What it is</span>
            <input
              className={inputClass}
              value={draft.label}
              onChange={(e) => set({ label: e.target.value })}
            />
          </label>
        </>
      ) : null}
      {tried && !built.ok ? (
        <ul className="space-y-0.5 text-xs text-[#E6A5B9]" data-testid="event-errors">
          {built.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      <Button size="sm" variant="secondary" onClick={add} data-testid="event-add">
        Add to this scenario
      </Button>

      {changes.length ? (
        <ul className="space-y-1 text-sm" data-testid="event-list">
          {changes.map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: list order is the scenario order
            <li key={i} className="flex items-start justify-between gap-2">
              <span>{changeText(c, formatExactCents)}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setChanges((cs) => cs.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No events added yet.</p>
      )}
      <label className="block space-y-1 text-xs">
        <span>Scenario name</span>
        <input
          className={inputClass}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          data-testid="event-label"
        />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={confirmed}
          disabled={payload === null}
          onChange={(e) => setConfirmedFor(e.target.checked ? payload : null)}
          data-testid="event-confirm"
        />
        <span>I reviewed these events. Run the forecast with exactly these.</span>
      </label>
      <Button
        onClick={run}
        disabled={!confirmed || pending || Boolean(p.disabled)}
        data-testid="event-run"
      >
        {pending ? "Running..." : "Run as a new scenario"}
      </Button>
      {p.disabled ? <p className="text-xs text-muted-foreground">{p.disabled}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-[#E6A5B9]">
          {error}
        </p>
      ) : null}
    </Panel>
  );
}
