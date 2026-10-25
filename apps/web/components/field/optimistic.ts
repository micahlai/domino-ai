import type { OptimisticLocalStore } from "convex/browser";
import type { FunctionArgs } from "convex/server";
import { api } from "../../convex/_generated/api";

type DecideArgs = FunctionArgs<typeof api.field.decide>;

/**
 * Optimistic field.decide: the flag leaves the open queue and joins the decided list in the
 * clicking person's own view before the server answers; the open counts drop with it. Convex
 * drops this local guess when the mutation settles (or fails) and shows the server's rows.
 * The person is shown as "You" until the server's name for them arrives.
 */
export function optimisticDecide(store: OptimisticLocalStore, args: DecideArgs) {
  const { companyId, findingId, decision, note } = args;
  const openArgs = { companyId, status: "open" as const };
  const open = store.getQuery(api.field.findings, openArgs);
  const hit = open?.find((f) => f.findingId === findingId);
  if (!open || !hit) return;
  store.setQuery(
    api.field.findings,
    openArgs,
    open.filter((f) => f.findingId !== findingId),
  );
  const decidedArgs = { companyId, status: decision };
  const decided = store.getQuery(api.field.findings, decidedArgs);
  const text = note?.trim();
  if (decided)
    store.setQuery(api.field.findings, decidedArgs, [
      {
        ...hit,
        status: decision,
        decidedBy: "You",
        decidedAt: new Date().toISOString(),
        ...(text && { note: text }),
      },
      ...decided,
    ]);
  for (const statusArgs of [{ companyId }, {}]) {
    const status = store.getQuery(api.field.status, statusArgs);
    if (!status || status.companyId !== companyId) continue;
    store.setQuery(api.field.status, statusArgs, {
      ...status,
      openFindings: Math.max(0, status.openFindings - 1),
      openEscalations: Math.max(0, status.openEscalations - (hit.escalated ? 1 : 0)),
    });
  }
}
