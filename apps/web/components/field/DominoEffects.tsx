"use client";

import { useConvex } from "convex/react";
import { makeFunctionReference } from "convex/server";
import Link from "next/link";
import { useState } from "react";
import type { CascadeView } from "../../convex/fieldCascade";
import { formatExactCents, formatFullDate } from "../timeline/baseline/format";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

const CASCADE_API = makeFunctionReference<
  "action",
  { companyId: string; runId: string; fieldCompanyId?: string },
  CascadeView
>("fieldCascade:run");

type Node = CascadeView["nodes"][number];

/**
 * "Show domino effects": looks ahead from one saved scenario run. The engine finds what the
 * scenario sets off (a lender's limit broken, a cash gap, a big customer loss, a windfall),
 * saves each follow-on as a branch of its parent, and this lists the chain with each branch's
 * lowest cash. Nothing is paid or moved.
 */
export function DominoEffects({
  companyId,
  runId,
  fieldCompanyId,
  hrefFor,
}: {
  companyId: string;
  runId: string;
  fieldCompanyId?: string;
  hrefFor?: (runId: string) => string;
}) {
  const convex = useConvex();
  const [state, setState] = useState<
    | { s: "idle" }
    | { s: "busy" }
    | { s: "done"; view: CascadeView }
    | { s: "error"; message: string }
  >({ s: "idle" });
  async function run() {
    if (!convex) return;
    setState({ s: "busy" });
    try {
      const view = await convex.action(CASCADE_API, {
        companyId,
        runId,
        ...(fieldCompanyId ? { fieldCompanyId } : {}),
      });
      setState({ s: "done", view });
    } catch (e) {
      setState({
        s: "error",
        message: e instanceof Error ? (e.message.split("\n")[0] ?? "") : "Could not look ahead",
      });
    }
  }
  const kids = (id: string | null, nodes: Node[]) => nodes.filter((n) => n.parentId === id);
  const tree = (id: string | null, nodes: Node[]) => {
    const list = kids(id, nodes);
    if (list.length === 0) return null;
    return (
      <ol className={id === null ? "space-y-3" : "mt-2 space-y-2 border-l pl-3"}>
        {list.map((n, i) => (
          <li key={n.id} data-testid={`domino-effect-${n.id}`} className="text-sm">
            {i === 0 || list[i - 1]?.trigger.label !== n.trigger.label ? (
              <p className="text-xs text-muted-foreground">
                Because: {n.trigger.label} ({formatFullDate(n.trigger.weekStart)})
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Or instead:</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <span aria-hidden="true">→</span>
              <span className="font-medium">{n.event}</span>
              <Badge variant="secondary">{n.likelihood}</Badge>
              <span className="text-xs text-muted-foreground">{n.branchLabel}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Lowest cash {formatExactCents(n.lowPoint.usable)}, week of{" "}
              {formatFullDate(n.lowPoint.weekStart)}
              {n.runId ? (
                <>
                  {" · "}
                  <Link
                    href={hrefFor ? hrefFor(n.runId) : (n.route ?? "#")}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    Open in forecast
                  </Link>
                </>
              ) : (
                ` · not saved: ${n.error ?? "unknown reason"}`
              )}
            </p>
            <p className="text-xs text-muted-foreground">{n.reason}</p>
            {tree(n.id, nodes)}
          </li>
        ))}
      </ol>
    );
  };
  return (
    <section className="space-y-2" data-testid="domino-effects">
      {state.s !== "done" ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={!convex || state.s === "busy"}
          onClick={run}
        >
          {state.s === "busy" ? "Looking ahead..." : "Show domino effects"}
        </Button>
      ) : null}
      {state.s === "error" ? (
        <p role="alert" className="text-xs text-muted-foreground">
          {state.message}
        </p>
      ) : null}
      {state.s === "done" ? (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm">
            <span className="font-medium">Domino effects of {state.view.event}</span>
            <span className="text-xs text-muted-foreground">
              {" "}
              · scenario lowest cash {formatExactCents(state.view.eventLow.cents)}
            </span>
          </p>
          {state.view.nodes.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No follow-on effects: this scenario does not break a rule, open a cash gap or hit a
              big customer.
            </p>
          ) : (
            tree(null, state.view.nodes)
          )}
          <p className="text-xs text-muted-foreground">
            Likelihoods are stated judgments from standard practice, not probabilities. Each branch
            is saved as a scenario; nothing is paid or moved.
          </p>
        </div>
      ) : null}
    </section>
  );
}
