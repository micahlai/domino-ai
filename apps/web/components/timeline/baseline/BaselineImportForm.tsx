"use client";

import { CompanyModelSchema, ConstraintSchema } from "@domino/contracts";
import { useEffect, useId, useState } from "react";
import { z } from "zod";
import { verifyWeeklySeedText, weeklyFixtureText } from "../../../lib/feature-boundary/verify";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { NEUTRAL_ASSUMPTION_NOTE, NEUTRAL_MODEL, type SaveBaselineArgs } from "./api";

export type BaselineDraft = Omit<SaveBaselineArgs, "requestId">;

type SeedCheck =
  | { state: "checking" }
  | { state: "ok"; company: string; asOf: string }
  | { state: "rejected"; reason: string };

/** Early, friendly shape check. The service checks every input again before saving. */
function checkJson<T>(text: string, schema: z.ZodType<T>): string | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return "This is not valid JSON.";
  }
  const r = schema.safeParse(value);
  if (r.success) return undefined;
  const i = r.error.issues[0];
  return i ? `${i.path.length ? `${i.path.join(".")}: ` : ""}${i.message}` : "Not valid.";
}

const ConstraintsSchema = z.array(ConstraintSchema);

export interface BaselineImportFormProps {
  onSave: (draft: BaselineDraft) => void;
  pending?: boolean;
  error?: string;
  /** Set when saving cannot work at all, for example no service connection. */
  unavailable?: string;
}

/** Import a weekly seed, review the explicit neutral assumptions, then save a baseline forecast. */
export function BaselineImportForm({
  onSave,
  pending,
  error,
  unavailable,
}: BaselineImportFormProps) {
  const id = useId();
  const [seedJson, setSeedJson] = useState(() => weeklyFixtureText("validKestrelWeeklySeed"));
  const [modelJson, setModelJson] = useState(() => JSON.stringify(NEUTRAL_MODEL, null, 2));
  const [constraintsJson, setConstraintsJson] = useState("[]");
  const [assumptionNote, setAssumptionNote] = useState(NEUTRAL_ASSUMPTION_NOTE);
  const [reviewed, setReviewed] = useState(false);
  const [seed, setSeed] = useState<SeedCheck>({ state: "checking" });

  useEffect(() => {
    let live = true;
    setSeed({ state: "checking" });
    verifyWeeklySeedText(seedJson).then(
      (r) =>
        live &&
        setSeed(
          r.ok
            ? { state: "ok", company: r.value.company.name, asOf: r.value.asOf }
            : { state: "rejected", reason: r.reason },
        ),
      () => live && setSeed({ state: "rejected", reason: "the seed could not be checked" }),
    );
    return () => {
      live = false;
    };
  }, [seedJson]);

  // A review covers exactly what is on screen: any change asks for it again.
  const edit = (set: (v: string) => void) => (v: string) => {
    set(v);
    setReviewed(false);
  };

  const modelIssue = checkJson(modelJson, CompanyModelSchema);
  const constraintsIssue = checkJson(constraintsJson, ConstraintsSchema);
  const noteIssue = assumptionNote.trim() ? undefined : "Write a short note about the assumptions.";
  const inputsOk = seed.state === "ok" && !modelIssue && !constraintsIssue && !noteIssue;
  const canSave = inputsOk && reviewed && !pending && !unavailable;

  const blocker = unavailable
    ? unavailable
    : seed.state === "checking"
      ? "Checking the weekly seed..."
      : seed.state === "rejected"
        ? "Fix the weekly seed before saving."
        : modelIssue || constraintsIssue
          ? "Fix the advanced assumptions before saving."
          : noteIssue
            ? noteIssue
            : !reviewed
              ? "Tick the review box to save."
              : undefined;

  return (
    <form
      className="space-y-5"
      aria-label="Save a baseline forecast"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) onSave({ seedJson, modelJson, constraintsJson, assumptionNote, reviewed });
      }}
    >
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">1. Weekly seed</legend>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-dashed text-clay">
            Peer fixture
          </Badge>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => edit(setSeedJson)(weeklyFixtureText("validKestrelWeeklySeed"))}
          >
            Load Kestrel weekly seed
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => edit(setSeedJson)(weeklyFixtureText("tamperedKestrelWeeklySeed"))}
          >
            Load tampered copy
          </Button>
        </div>
        <textarea
          aria-label="Weekly seed JSON"
          className="h-32 w-full rounded-md border bg-background p-2 font-mono text-xs"
          spellCheck={false}
          value={seedJson}
          onChange={(e) => edit(setSeedJson)(e.target.value)}
        />
        <output data-testid="baseline-seed-check" className="block text-sm">
          {seed.state === "checking"
            ? "Checking the weekly seed..."
            : seed.state === "ok"
              ? `Seed checks out: ${seed.company}, weeks from ${seed.asOf}.`
              : `Seed rejected: ${seed.reason}`}
        </output>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">2. Assumptions</legend>
        <p className="max-w-3xl text-sm text-muted-foreground">
          This starts from a neutral model, not one learned from this company: customers pay on
          their stated terms and nothing else is assumed. No lender&rsquo;s limits are added, so the
          forecast cannot show a broken rule.
        </p>
        <label className="block space-y-1 text-sm" htmlFor={`${id}-note`}>
          <span className="text-muted-foreground">Note saved with the forecast</span>
          <textarea
            id={`${id}-note`}
            className="h-20 w-full rounded-md border bg-background p-2 text-sm"
            value={assumptionNote}
            onChange={(e) => edit(setAssumptionNote)(e.target.value)}
          />
        </label>
        {noteIssue ? <p className="text-sm text-destructive">{noteIssue}</p> : null}
        <details className="rounded-md border p-3" open={Boolean(modelIssue || constraintsIssue)}>
          <summary className="cursor-pointer text-sm">
            Advanced: model and cash rules as JSON
          </summary>
          <div className="mt-3 space-y-3">
            <label className="block space-y-1 text-sm">
              <span className="text-muted-foreground">Model (CompanyModel)</span>
              <textarea
                aria-label="Model JSON"
                className="h-32 w-full rounded-md border bg-background p-2 font-mono text-xs"
                spellCheck={false}
                value={modelJson}
                onChange={(e) => edit(setModelJson)(e.target.value)}
              />
            </label>
            {modelIssue ? <p className="text-sm text-destructive">Model: {modelIssue}</p> : null}
            <label className="block space-y-1 text-sm">
              <span className="text-muted-foreground">Cash rules (Constraint list)</span>
              <textarea
                aria-label="Cash rules JSON"
                className="h-20 w-full rounded-md border bg-background p-2 font-mono text-xs"
                spellCheck={false}
                value={constraintsJson}
                onChange={(e) => edit(setConstraintsJson)(e.target.value)}
              />
            </label>
            {constraintsIssue ? (
              <p className="text-sm text-destructive">Cash rules: {constraintsIssue}</p>
            ) : null}
          </div>
        </details>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">3. Review and save</legend>
        <label className="flex min-h-11 items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4"
            checked={reviewed}
            disabled={!inputsOk}
            onChange={(e) => setReviewed(e.target.checked)}
          />
          <span>I have read these assumptions and want to save a forecast using them.</span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!canSave}>
            {pending ? "Saving..." : "Save forecast"}
          </Button>
          {blocker && !pending ? (
            <span className="text-sm text-muted-foreground" data-testid="baseline-blocker">
              {blocker}
            </span>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive" data-testid="baseline-save-error">
            {error}
          </p>
        ) : null}
      </fieldset>
    </form>
  );
}
