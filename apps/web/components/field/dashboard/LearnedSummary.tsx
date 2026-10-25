"use client";

import { useQuery } from "convex/react";
import { Sparkles } from "lucide-react";
import Link from "next/link";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useSelectedCompany } from "../company";

/**
 * Dashboard pointer to "What Domino learned" (convex/fieldLearning.ts). Shows only real items:
 * active rules from this company's decisions and payment delays from observed payments.
 */
export function LearnedSummary() {
  const { companyId } = useSelectedCompany();
  const data = useQuery(
    api.fieldLearning.list,
    companyId ? { companyId: companyId as Id<"companies"> } : "skip",
  );
  if (!data) return null;
  const active = data.rules.filter((r) => r.active);
  if (active.length === 0 && data.paymentDelays.length === 0) return null;
  const top = data.paymentDelays[0];
  return (
    <section
      aria-label="What Domino learned"
      className="flex flex-wrap items-start justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-sm shadow-xs"
    >
      <div className="min-w-0 space-y-0.5">
        <p className="flex items-center gap-1.5 font-semibold">
          <Sparkles aria-hidden="true" className="size-4 text-primary" />
          What Domino learned
        </p>
        <p className="text-[13px] text-muted-foreground">
          {active.length} active rule{active.length === 1 ? "" : "s"} from your decisions
          {data.paymentDelays.length > 0
            ? `, ${data.paymentDelays.length} customer payment pattern${data.paymentDelays.length === 1 ? "" : "s"} used by this forecast`
            : ""}
          .
        </p>
        {top ? <p className="text-[13px] text-muted-foreground">{top.text}</p> : null}
      </div>
      <Link
        href="/field#learned"
        className="inline-flex min-h-11 items-center text-[13px] font-medium text-primary underline-offset-4 hover:underline sm:min-h-0"
      >
        Review and undo
      </Link>
    </section>
  );
}
