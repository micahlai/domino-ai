"use client";

import type { Change } from "@domino/contracts";
import { useReducer, useState } from "react";
import { Button } from "../../ui/button";
import { formatExactCents } from "../baseline/format";
import { inputClass } from "./RuleEditor";
import { composerPayload, composerReducer, newComposer } from "./composer";
import {
  EVENT_KINDS,
  type EventDraft,
  type EventKind,
  type Option,
  buildChange,
  changeText,
} from "./drafts";
import { type Outcome, isConfirmed } from "./requests";

export type EventFormProps = {
  firstWeek: string;
  /** Date for newly created cash events only; never changes an entered draft. */
  defaultDate: string;
  invoices: Option[];
  bills: Option[];
  /** Explicitly offered to the person; selecting a chart item never replaces a draft. */
  suggestion?: EventDraft;
  onRun: (label: string, changes: Change[]) => Promise<Outcome>;
  disabled?: string;
};

/** Explicit future events, run together as one new scenario after the person confirms them. */
export function EventForm(p: EventFormProps) {
  const [state, dispatch] = useReducer(composerReducer, undefined, newComposer);
  const { draft, changes, label, confirmedFor, tried } = state;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const built = buildChange(draft, p.firstWeek);
  const payload = composerPayload(state);
  const confirmed = isConfirmed(confirmedFor, payload);
  const set = (patch: Partial<EventDraft>) => dispatch({ type: "edit", patch });

  function add() {
    dispatch({ type: "add", firstWeek: p.firstWeek, defaultDate: p.defaultDate });
  }

  async function run() {
    if (!payload || !confirmed || pending) return;
    setPending(true);
    setError(undefined);
    try {
      const out = await p.onRun(label.trim(), changes);
      if (!out.ok) setError(out.message);
    } catch {
      setError(
        "Could not confirm whether the scenario was saved. Your draft is kept; retry to check it.",
      );
    } finally {
      setPending(false);
    }
  }

  const needsInvoice = draft.kind === "delay_invoice" || draft.kind === "lose_invoice";
  const needsDays = draft.kind === "delay_invoice" || draft.kind === "delay_bill";
  const needsMoney = draft.kind === "add_cash" || draft.kind === "remove_cash";

  return (
    <div className="space-y-4" data-testid="event-form">
      {p.suggestion ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Use the selected scheduled item for this event. Queued events stay unchanged.</span>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => {
              if (p.suggestion) dispatch({ type: "suggestion", draft: p.suggestion });
            }}
          >
            Replace current event with selected{" "}
            {p.suggestion.kind === "delay_bill" ? "bill" : "invoice"}
          </Button>
        </div>
      ) : null}
      <fieldset disabled={pending} className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="sr-only">Describe the event</legend>
        <label className="block space-y-1 text-xs">
          <span>What happens</span>
          <select
            className={inputClass}
            value={draft.kind}
            onChange={(e) =>
              dispatch({
                type: "kind",
                kind: e.target.value as EventKind,
                defaultDate: p.defaultDate,
              })
            }
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
        {!needsMoney ? (
          <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-3">
            Timing follows the selected invoice or bill and its delay, rather than the chart week.
          </p>
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
      </fieldset>
      {tried && !built.ok ? (
        <ul className="space-y-0.5 text-xs text-destructive" data-testid="event-errors">
          {built.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={add}
        data-testid="event-add"
      >
        Queue this event
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
                className="shrink-0"
                disabled={pending}
                onClick={() => dispatch({ type: "remove", index: i })}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No events queued yet.</p>
      )}
      <label className="block space-y-1 text-xs">
        <span>Scenario name</span>
        <input
          className={inputClass}
          value={label}
          disabled={pending}
          onChange={(e) => dispatch({ type: "label", label: e.target.value })}
          data-testid="event-label"
        />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={confirmed}
          disabled={payload === null || pending}
          onChange={(e) => dispatch({ type: "review", checked: e.target.checked })}
          data-testid="event-confirm"
        />
        <span>I reviewed the queued events. Run the forecast with exactly these.</span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={run}
          disabled={!confirmed || pending || Boolean(p.disabled)}
          data-testid="event-run"
        >
          {pending ? "Running..." : "Run as a new scenario"}
        </Button>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => {
            dispatch({ type: "discard" });
            setError(undefined);
          }}
        >
          Discard draft
        </Button>
      </div>
      {p.disabled ? <p className="text-xs text-muted-foreground">{p.disabled}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
