"use client";

import { useMutation, useQuery } from "convex/react";
import { ChevronRight, Sparkles, Undo2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";

// "What Domino learned": rules learned from this company's decisions (convex/fieldLearning.ts),
// each with its source decision, scope, times applied, last effect and Undo, plus the customer
// payment delays the forecast already learned from observed payments. Live backend only.

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function LearnedSection({ companyId }: { companyId: string }) {
  const data = useQuery(api.fieldLearning.list, { companyId: companyId as Id<"companies"> });
  const undo = useMutation(api.fieldLearning.undo);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  if (!data) return null;
  const active = data.rules.filter((r) => r.active).length;
  return (
    <details
      className="group scroll-mt-20 rounded-lg border bg-card shadow-xs"
      id="learned"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="size-4 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none"
        />
        <Sparkles aria-hidden="true" className="size-4 text-primary" />
        <span className="font-semibold">What Domino learned</span>
        <span className="text-[13px] text-muted-foreground">
          {active} active rule{active === 1 ? "" : "s"}
          {data.paymentDelays.length > 0
            ? ` · ${data.paymentDelays.length} payment pattern${data.paymentDelays.length === 1 ? "" : "s"}`
            : ""}
        </span>
      </summary>
      <div className="space-y-4 border-t px-4 py-3 text-sm">
        {data.rules.length === 0 ? (
          <p className="text-muted-foreground">
            Nothing learned from your decisions yet. Dismiss a flag with a reason, confirm an issue,
            or approve or dismiss a suggestion, and Domino applies it to later checks for this
            company only.
          </p>
        ) : (
          <ul className="divide-y">
            {data.rules.map((r) => (
              <li
                key={r.ruleId}
                className="flex flex-wrap items-start justify-between gap-3 py-2.5"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="font-medium">
                    {r.rule}{" "}
                    <Badge variant={r.active ? "success" : "secondary"}>
                      {r.active ? `Active · v${r.version}` : "Undone"}
                    </Badge>
                  </p>
                  <p className="text-[13px] text-muted-foreground">
                    {r.source} on {day(r.learnedAt)}: {r.sourceSummary}. Reason: “{r.reason}”
                  </p>
                  <p className="text-[13px] text-muted-foreground">
                    {r.scope} · from {r.versions} decision{r.versions === 1 ? "" : "s"} · applied to
                    later checks {r.applied} time{r.applied === 1 ? "" : "s"}
                    {r.lastEffect ? ` · last: ${r.lastEffect}` : ""}
                    {r.undoneAt ? ` · undone ${day(r.undoneAt)}` : ""}
                  </p>
                </div>
                {r.active ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={async () => {
                      setBusy(r.ruleId);
                      setError(null);
                      try {
                        await undo({ companyId: companyId as Id<"companies">, ruleId: r.ruleId });
                      } catch (e) {
                        setError(e instanceof Error ? e.message : "Could not undo the rule.");
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    <Undo2 aria-hidden="true" />
                    Undo
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {error ? <p className="text-destructive">{error}</p> : null}
        {data.paymentDelays.length > 0 ? (
          <div className="space-y-1">
            <p className="text-[13px] font-medium">
              Payment behavior the forecast uses to date expected collections
              {data.asOf ? (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  (observed payments in books as of {data.asOf})
                </span>
              ) : null}
            </p>
            <ul className="space-y-0.5 text-[13px] text-muted-foreground">
              {data.paymentDelays.slice(0, 3).map((p) => (
                <li key={p.customerId}>{p.text}</li>
              ))}
            </ul>
            <Link
              href="/field/customers"
              className="inline-flex min-h-11 items-center text-[13px] font-medium text-primary underline-offset-4 hover:underline sm:min-h-0"
            >
              All customers and payment behavior
            </Link>
          </div>
        ) : null}
      </div>
    </details>
  );
}
