import type { SourceKind } from "@domino/contracts";
import { CheckCircle2, Circle } from "lucide-react";

export interface SourcePreview {
  kind: SourceKind;
  label: string;
  status: "found" | "learned" | "checked" | "needs_review";
}

export function ConnectChecklist({ sources }: { sources: SourcePreview[] }) {
  return (
    <ul className="divide-y">
      {sources.map((source) => (
        <li key={source.kind} className="flex items-center justify-between gap-4 py-4 text-sm">
          <span className="font-medium">{source.label}</span>
          <span className="flex items-center gap-2 text-muted-foreground">
            {source.status === "checked" ? (
              <CheckCircle2 className="size-4" aria-hidden="true" />
            ) : (
              <Circle className="size-4" aria-hidden="true" />
            )}
            {source.status === "needs_review"
              ? "Needs review"
              : source.status === "checked"
                ? "Checked against bank"
                : source.status === "learned"
                  ? "Learned"
                  : "Found"}
          </span>
        </li>
      ))}
    </ul>
  );
}
