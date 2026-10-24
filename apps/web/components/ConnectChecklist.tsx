import type { SourceKind } from "@domino/contracts";
import { CheckCircle2, Circle, CircleAlert } from "lucide-react";
export interface SourcePreview {
  kind: SourceKind;
  label: string;
  status: "found" | "learned" | "checked" | "needs_review";
  step?: string;
}
export function ConnectChecklist({ sources }: { sources: SourcePreview[] }) {
  return (
    <ul className="divide-y" aria-live="polite" aria-relevant="additions text">
      {sources.map((source, index) => (
        <li
          key={source.kind}
          className="flex items-start justify-between gap-4 py-4 text-sm motion-safe:animate-in motion-safe:fade-in"
          style={{ animationDelay: `${index * 60}ms` }}
        >
          <div>
            <p className="font-medium">{source.label}</p>
            {source.step ? (
              <p className="mt-1 text-xs text-muted-foreground">{source.step}</p>
            ) : null}
          </div>
          <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            {source.status === "checked" ? (
              <CheckCircle2 className="size-4 text-primary" aria-hidden="true" />
            ) : source.status === "needs_review" ? (
              <CircleAlert className="size-4 text-destructive" aria-hidden="true" />
            ) : (
              <Circle className="size-4" aria-hidden="true" />
            )}
            {source.status === "checked"
              ? "Checked against bank"
              : source.status === "needs_review"
                ? "Needs review"
                : source.status === "learned"
                  ? "Mapped"
                  : "Found"}
          </span>
        </li>
      ))}
    </ul>
  );
}
