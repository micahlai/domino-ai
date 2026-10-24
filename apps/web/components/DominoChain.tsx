import { ProofDrawer } from "@/components/ProofDrawer";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Domino } from "@domino/contracts";

export function DominoChain({ dominoes }: { dominoes: Domino[] }) {
  return (
    <ol className="space-y-5">
      {dominoes.map((step) => (
        <li key={step.order} className="flex gap-3">
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm",
              step.constraintId && "bg-destructive/10 text-destructive",
            )}
          >
            {step.order}
          </span>
          <div>
            <p className={cn("text-sm leading-6", step.constraintId && "text-destructive")}>
              {step.label}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Week of {formatDate(step.weekStart)}
            </p>
            {step.evidence.length ? (
              <div className="mt-2">
                <ProofDrawer evidence={step.evidence} />
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                No source record attached to this step.
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
