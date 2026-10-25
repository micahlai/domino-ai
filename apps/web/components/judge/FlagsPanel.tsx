"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { describeFinding } from "../field/finding-text";
import { FINDING_LABEL, SEVERITY_LABEL } from "../field/parts";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Section } from "../ui/page";
import { ProofLabel, errorText } from "./shared";

// Open flags for the judge company, decided inline through field.decide (the same mutation the
// Worker page uses). A decision writes an approval row and an action-log row.

type Flag = NonNullable<ReturnType<typeof useQuery<typeof api.field.findings>>>[number];

export function FlagsPanel({ companyId }: { companyId: Id<"companies"> }) {
  const open = useQuery(api.field.findings, { companyId, status: "open" });
  const flags = [...(open ?? [])].sort(
    (a, b) => Number(b.escalated) - Number(a.escalated) || (a.detectedAt < b.detectedAt ? 1 : -1),
  );
  return (
    <Section
      title="Decide a flag"
      description="The audit agent flags what looks wrong. A person decides; nothing acts alone."
      actions={<ProofLabel kind="real">Real audit and decisions</ProofLabel>}
      flush
    >
      {open === undefined ? (
        <p className="p-[var(--card-pad)] text-sm text-muted-foreground">Loading flags</p>
      ) : flags.length === 0 ? (
        <p className="p-[var(--card-pad)] text-sm text-muted-foreground">
          No open flags. Try "Bank and Stripe disagree": the audit agent should flag it within a few
          seconds.
        </p>
      ) : (
        <ul className="divide-y">
          {flags.slice(0, 8).map((f) => (
            <FlagRow key={f.findingId} companyId={companyId} flag={f} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function FlagRow({ companyId, flag }: { companyId: Id<"companies">; flag: Flag }) {
  const decide = useMutation(api.field.decide);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const text = describeFinding(flag);
  const noteId = `note-${flag.findingId}`;
  async function go(decision: "approved" | "rejected") {
    setBusy(true);
    setError(null);
    try {
      await decide({
        companyId,
        findingId: flag.findingId,
        decision,
        ...(note.trim() && { note: note.trim() }),
      });
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }
  return (
    <li className="space-y-3 p-[var(--card-pad)]">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={flag.severity === "high" ? "destructive" : "secondary"}>
          {SEVERITY_LABEL[flag.severity]}
        </Badge>
        <span className="text-sm font-medium">{FINDING_LABEL[flag.kind]}</span>
        <span className="text-xs text-muted-foreground">Found by the rules engine (no AI)</span>
      </div>
      <p className="text-sm leading-6">{text.headline}</p>
      {text.facts.length > 0 ? (
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          {text.facts.map((f) => (
            <div key={f.label} className="flex gap-1.5">
              <dt className="text-muted-foreground">{f.label}</dt>
              <dd className="font-medium tabular-nums">{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {flag.explanation ? (
        <p className="text-sm leading-6 text-muted-foreground">
          <span className="font-medium text-primary-ink">Claude ({flag.explanation.model}):</span>{" "}
          {flag.explanation.text}
        </p>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[12rem] flex-1 space-y-1">
          <label htmlFor={noteId} className="text-[13px] font-medium text-muted-foreground">
            Note (optional)
          </label>
          <Input
            id={noteId}
            maxLength={500}
            placeholder="Why you decided this"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <Button disabled={busy} onClick={() => go("approved")}>
          Confirm issue
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => go("rejected")}>
          Dismiss flag
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </li>
  );
}
