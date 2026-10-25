"use client";

import { useMutation, useQuery } from "convex/react";
import { type FormEvent, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  SCENARIO_LABEL,
  type Scenario,
  type ScenarioKind,
  ScenarioSchema,
  parseDollars,
  zodMessage,
} from "../../convex/lib/judge";
import { cn } from "../../lib/utils";
import { formatCents } from "../field/dashboard/money";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Section } from "../ui/page";
import { Select } from "../ui/select";
import { FieldLabel, ProofLabel, errorText } from "./shared";

// Scenario form: pick what happens, fill a preset or custom values, plant it. The mutation
// (fieldJudge.submitScenario) re-validates with the same Zod schema, so the form check is a
// convenience, not the gate.

const WEEKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
const KINDS: ScenarioKind[] = [
  "late_payment",
  "customer_leaves",
  "unplanned_expense",
  "payroll_raise",
  "bank_stripe_mismatch",
];

const HELP: Record<ScenarioKind, string> = {
  late_payment: "Their open invoices come due later and future billing gets longer terms.",
  customer_leaves:
    "Their billing stops today and open deals are lost. Open invoices are still owed.",
  unplanned_expense: "A new bill lands in the books, due in the week you pick.",
  payroll_raise: "Every upcoming payroll run costs more.",
  bank_stripe_mismatch:
    "The bank reports a recent deposit at a different amount than Stripe recorded.",
};

type Values = {
  customerId: string;
  days: string;
  amount: string;
  week: string;
  label: string;
  percent: string;
};
const EMPTY: Values = {
  customerId: "",
  days: "30",
  amount: "",
  week: "3",
  label: "",
  percent: "10",
};

const PRESETS: Record<ScenarioKind, { label: string; values: Partial<Values> }[]> = {
  late_payment: [
    { label: "30 days", values: { days: "30" } },
    { label: "60 days", values: { days: "60" } },
    { label: "90 days", values: { days: "90" } },
  ],
  customer_leaves: [],
  unplanned_expense: [
    {
      label: "$50K in week 2",
      values: { amount: "50000", week: "2", label: "Server outage repair" },
    },
    {
      label: "$400K in week 4",
      values: { amount: "400000", week: "4", label: "Lawsuit settlement" },
    },
    { label: "$2M in week 6", values: { amount: "2000000", week: "6", label: "Office fire" } },
  ],
  payroll_raise: [
    { label: "+5%", values: { percent: "5" } },
    { label: "+10%", values: { percent: "10" } },
    { label: "+25%", values: { percent: "25" } },
  ],
  bank_stripe_mismatch: [
    { label: "Bank $250 short", values: { amount: "-250" } },
    { label: "Bank $5,000 short", values: { amount: "-5000" } },
    { label: "Bank $1,200 over", values: { amount: "1200" } },
  ],
};

/** Form values -> scenario input, or a plain error. Money is parsed as strings to cents. */
function toScenario(kind: ScenarioKind, v: Values): { scenario: Scenario } | { error: string } {
  const cents = v.amount.trim() ? parseDollars(v.amount) : null;
  if ((kind === "unplanned_expense" || kind === "bank_stripe_mismatch") && cents === null)
    return { error: "Enter a dollar amount like 50000 or 1,250.50" };
  const raw =
    kind === "late_payment"
      ? { kind, customerId: v.customerId, days: Number(v.days) }
      : kind === "customer_leaves"
        ? { kind, customerId: v.customerId }
        : kind === "unplanned_expense"
          ? {
              kind,
              amountCents: cents,
              week: Number(v.week),
              ...(v.label.trim() && { label: v.label.trim() }),
            }
          : kind === "payroll_raise"
            ? { kind, percent: Number(v.percent) }
            : { kind, amountCents: cents };
  const parsed = ScenarioSchema.safeParse(raw);
  return parsed.success ? { scenario: parsed.data } : { error: zodMessage(parsed.error) };
}

export function ScenarioForm({
  companyId,
  ready,
  usedThisMinute,
  perMinute,
}: {
  companyId: Id<"companies">;
  ready: boolean;
  usedThisMinute: number;
  perMinute: number;
}) {
  const customers = useQuery(api.fieldJudge.customers, { companyId });
  const submit = useMutation(api.fieldJudge.submitScenario);
  const [kind, setKind] = useState<ScenarioKind>("late_payment");
  const [values, setValues] = useState<Values>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const top = customers?.slice(0, 10) ?? [];
  const customerId = values.customerId || top[0]?.id || "";
  const set = (patch: Partial<Values>) => setValues((v) => ({ ...v, ...patch }));
  const needsCustomer = kind === "late_payment" || kind === "customer_leaves";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const built = toScenario(kind, { ...values, customerId });
    if ("error" in built) {
      setResult({ ok: false, text: built.error });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const r = await submit({ companyId, scenario: built.scenario });
      setResult({ ok: true, text: `Planted. ${r.summary}. The agents are reading it now.` });
    } catch (error) {
      setResult({ ok: false, text: errorText(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Add a scenario"
      description="Something happens at this company. Domino's agents pick it up from the mock tools."
      actions={<ProofLabel kind="simulated">Plants simulated data</ProofLabel>}
    >
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <fieldset className="space-y-2">
          <legend className="text-[13px] font-medium text-muted-foreground">What happens</legend>
          <div className="flex flex-wrap gap-1.5">
            {KINDS.map((k) => (
              <label key={k} className="relative">
                <input
                  type="radio"
                  name="judge-scenario"
                  value={k}
                  checked={kind === k}
                  onChange={() => {
                    setKind(k);
                    setResult(null);
                    set({ amount: "" });
                  }}
                  className="peer sr-only"
                />
                <span className="flex h-8 cursor-pointer items-center rounded-md border border-input bg-card px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground peer-checked:border-foreground peer-checked:text-foreground peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-ring max-sm:h-11">
                  {SCENARIO_LABEL[k]}
                </span>
              </label>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">{HELP[kind]}</p>
        </fieldset>

        {PRESETS[kind].length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13px] text-muted-foreground">Presets</span>
            {PRESETS[kind].map((p) => (
              <Button
                key={p.label}
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => set(p.values)}
              >
                {p.label}
              </Button>
            ))}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          {needsCustomer ? (
            <div className="space-y-1.5 sm:col-span-2">
              <FieldLabel htmlFor="judge-customer">Customer</FieldLabel>
              <Select
                id="judge-customer"
                value={customerId}
                onChange={(e) => set({ customerId: e.target.value })}
                disabled={!customers || top.length === 0}
              >
                {top.length === 0 ? <option value="">Loading customers</option> : null}
                {top.map((c, i) => (
                  <option key={c.id} value={c.id}>
                    {i === 0 ? "Top customer: " : ""}
                    {c.name} · {formatCents(c.yearlyCents)} a year
                    {c.openCents > 0 ? `, ${formatCents(c.openCents)} owed now` : ""}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          {kind === "late_payment" ? (
            <div className="space-y-1.5">
              <FieldLabel htmlFor="judge-days">Days late (1 to 120)</FieldLabel>
              <Input
                id="judge-days"
                inputMode="numeric"
                value={values.days}
                onChange={(e) => set({ days: e.target.value })}
              />
            </div>
          ) : null}
          {kind === "unplanned_expense" || kind === "bank_stripe_mismatch" ? (
            <div className="space-y-1.5">
              <FieldLabel htmlFor="judge-amount">
                {kind === "unplanned_expense" ? "Amount ($)" : "Bank minus Stripe ($, + or −)"}
              </FieldLabel>
              <Input
                id="judge-amount"
                inputMode="decimal"
                placeholder={kind === "unplanned_expense" ? "50000" : "-250"}
                value={values.amount}
                onChange={(e) => set({ amount: e.target.value })}
              />
            </div>
          ) : null}
          {kind === "unplanned_expense" ? (
            <>
              <div className="space-y-1.5">
                <FieldLabel htmlFor="judge-week">Due in week</FieldLabel>
                <Select
                  id="judge-week"
                  value={values.week}
                  onChange={(e) => set({ week: e.target.value })}
                >
                  {WEEKS.map((w) => (
                    <option key={w} value={String(w)}>
                      Week {w} of 13
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <FieldLabel htmlFor="judge-label">What it is (optional)</FieldLabel>
                <Input
                  id="judge-label"
                  maxLength={60}
                  placeholder="Unplanned expense"
                  value={values.label}
                  onChange={(e) => set({ label: e.target.value })}
                />
              </div>
            </>
          ) : null}
          {kind === "payroll_raise" ? (
            <div className="space-y-1.5">
              <FieldLabel htmlFor="judge-percent">Increase (1 to 50%)</FieldLabel>
              <Input
                id="judge-percent"
                inputMode="numeric"
                value={values.percent}
                onChange={(e) => set({ percent: e.target.value })}
              />
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={busy || !ready}>
            {busy ? "Planting" : "Add scenario"}
          </Button>
          <span className="text-[13px] text-muted-foreground">
            {!ready
              ? "Waiting for the agents' first read"
              : `At most ${perMinute} changes a minute${usedThisMinute > 0 ? ` (${usedThisMinute} recently)` : ""}`}
          </span>
        </div>
        {result ? (
          <p
            role={result.ok ? "status" : "alert"}
            className={cn("text-sm", result.ok ? "text-foreground" : "text-destructive")}
          >
            {result.text}
          </p>
        ) : null}
      </form>
    </Section>
  );
}
