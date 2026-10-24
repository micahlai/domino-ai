import { ProofDrawer } from "@/components/ProofDrawer";
import type { LearnedRule } from "@domino/contracts";
import { ArrowRight } from "lucide-react";

export function RuleCard({ rule }: { rule: LearnedRule }) {
  return (
    <div className="space-y-5">
      <p className="text-sm leading-6">{rule.text}</p>
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        Past forecast error:{" "}
        <span className="font-medium text-foreground">{rule.errorBefore}%</span>
        <ArrowRight className="size-4" aria-label="improved to" />
        <span className="font-medium text-foreground">{rule.errorAfter}%</span>
      </p>
      <ProofDrawer evidence={rule.evidence} />
    </div>
  );
}
