"use client";

import { ExternalLink } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { formatReportDate } from "../historical/format";
import { safeHref } from "../investigate/graph";
import { CompanyKnowledge } from "../investigate/live/CompanyKnowledge";
import type { Adapted } from "../investigate/live/adapt";
import { NeedsService, NoInvestigation, Pending, type Saved, useSaved } from "./Saved";

// Company: what the saved baseline forecast was computed from. Only the frozen baseline run is
// read (through CompanyKnowledge); nothing from after the cutoff is requested here.

// Saved source dates are free text to the adapter, so a malformed one is shown as written.
function shownDay(timestamp: string) {
  try {
    return formatReportDate(timestamp.slice(0, 10));
  } catch {
    return timestamp;
  }
}

function sourcesOf(adapted: Adapted) {
  const seen = new Map<string, NonNullable<Adapted["nodes"][number]["evidence"]>[number]>();
  for (const node of adapted.nodes)
    if (node.kind === "source") for (const item of node.evidence ?? []) seen.set(item.id, item);
  return [...seen.values()];
}

export function CompanyBody({ adapted }: { adapted: Adapted }) {
  const baselineRunId = [...adapted.outputs.values()][0]?.baselineRunId;
  const sources = sourcesOf(adapted);
  return (
    <>
      <CompanyKnowledge key={baselineRunId ?? "pending"} runId={baselineRunId} />
      <section aria-labelledby="company-sources" className="mt-8">
        <h3 id="company-sources" className="text-sm font-medium">
          Sources
        </h3>
        {sources.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No sources saved yet.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {sources.map((s) => {
              const href = safeHref(s.url);
              return (
                <li key={s.id}>
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center gap-1.5 rounded text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {s.title}
                      <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
                    </a>
                  ) : (
                    <span>{s.title}</span>
                  )}
                  {s.publishedAt ? (
                    <span className="block text-xs text-muted-foreground">
                      Published {shownDay(s.publishedAt)}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

function SavedCompany({ id }: { id: string }) {
  const saved: Saved = useSaved(id);
  return saved.state === "ready" ? (
    <CompanyBody adapted={saved.adapted} />
  ) : (
    <Pending saved={saved} />
  );
}

export function CompanyView() {
  const id = useSearchParams().get("c") || undefined;
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-8">
      <h2 className="text-xl font-medium">What Domino knows about this company</h2>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">
        The facts and assumptions behind the saved forecast, with where each came from.
      </p>
      <NeedsService>{id ? <SavedCompany id={id} /> : <NoInvestigation />}</NeedsService>
    </div>
  );
}
