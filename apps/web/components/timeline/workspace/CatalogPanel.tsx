import Link from "next/link";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Skeleton } from "../../ui/skeleton";
import { formatExactCents, formatSavedAt } from "../baseline/format";
import { Panel, WhenDate } from "./RunPanels";
import { type CatalogEntry, type CatalogPage, type Read, ancestryOf } from "./api";

const KIND: Record<CatalogEntry["kind"], string> = {
  baseline: "Imported baseline",
  rules: "Rules changed",
  scenario: "Scenario",
};

function EntryRow({
  e,
  href,
  current,
}: {
  e: CatalogEntry;
  href: string;
  current?: boolean;
}) {
  return (
    <li
      className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t py-2 text-sm first:border-t-0"
      data-testid={`entry-${e.runId}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{KIND[e.kind]}</Badge>
        {current ? (
          <span className="font-medium" aria-current="page">
            {e.label || "Untitled"} (open now)
          </span>
        ) : (
          <Link href={href} className="text-primary underline-offset-4 hover:underline">
            {e.label || "Untitled"}
          </Link>
        )}
      </div>
      <span className="text-xs text-muted-foreground">
        Low point {formatExactCents(e.lowPointCents)}, week of <WhenDate iso={e.lowPointWeek} />.
        Saved {formatSavedAt(e.savedAt)}
      </span>
    </li>
  );
}

function ReadNotice({ read, what }: { read: Read<unknown>; what: string }) {
  if (read.state === "loading")
    return (
      <div className="space-y-2" aria-busy="true">
        <output className="block text-xs text-muted-foreground">Reading {what}...</output>
        <Skeleton className="h-10 w-full" />
      </div>
    );
  if (read.state === "ready") return null;
  return (
    <p role="alert" className="text-sm text-muted-foreground">
      {read.state === "missing"
        ? `No ${what} found.`
        : read.state === "error"
          ? `The ${what} could not be loaded. Check the connection and reload. Nothing has changed.`
          : `The ${what} came back in an unexpected shape, so it is not shown.`}
    </p>
  );
}

/** Saved scenarios for this company, newest first. Reading only: opening never recalculates. */
export function CatalogList({
  pages,
  onMore,
  hrefFor,
}: {
  pages: Read<CatalogPage>[];
  onMore: (cursor: string) => void;
  hrefFor: (runId: string) => string;
}) {
  const ready = pages.flatMap((p) => (p.state === "ready" ? p.value.entries : []));
  const last = pages[pages.length - 1];
  const blocked = pages.find((p) => p.state !== "ready");
  return (
    <Panel title="Saved scenarios" testId="catalog">
      {ready.length ? (
        <ul>
          {ready.map((e) => (
            <EntryRow key={e.runId} e={e} href={hrefFor(e.runId)} />
          ))}
        </ul>
      ) : last?.state === "ready" ? (
        <p className="text-sm text-muted-foreground">
          No saved scenarios yet. Save a baseline forecast, then open it here.
        </p>
      ) : null}
      {blocked ? <ReadNotice read={blocked} what="saved scenarios" /> : null}
      {last?.state === "ready" && !last.value.isDone ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onMore(last.value.continueCursor)}
          data-testid="catalog-more"
        >
          Show older scenarios
        </Button>
      ) : null}
    </Panel>
  );
}

/** Where the open scenario came from and what was built on it. */
export function AncestryPanel({
  graph,
  runId,
  hrefFor,
}: {
  graph: Read<CatalogEntry[]>;
  runId: string;
  hrefFor: (runId: string) => string;
}) {
  if (graph.state !== "ready")
    return (
      <Panel title="How this scenario was built" testId="ancestry">
        <ReadNotice read={graph} what="scenario history" />
      </Panel>
    );
  const a = ancestryOf(graph.value, runId);
  return (
    <Panel title="How this scenario was built" testId="ancestry">
      <ol className="space-y-0">
        {a.path.map((e) => (
          <EntryRow key={e.runId} e={e} href={hrefFor(e.runId)} current={e.runId === runId} />
        ))}
      </ol>
      {a.broken ? (
        <p className="text-xs text-muted-foreground" data-testid="ancestry-broken">
          Some earlier steps are not listed here.
        </p>
      ) : null}
      {a.children.length ? (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Built on this one</p>
          <ul>
            {a.children.map((e) => (
              <EntryRow key={e.runId} e={e} href={hrefFor(e.runId)} />
            ))}
          </ul>
        </div>
      ) : null}
      {a.truncated ? (
        <p className="text-xs text-muted-foreground" data-testid="ancestry-truncated">
          Showing the first 100 saved scenarios from this baseline; some may not be listed.
        </p>
      ) : null}
    </Panel>
  );
}

export { ReadNotice };
